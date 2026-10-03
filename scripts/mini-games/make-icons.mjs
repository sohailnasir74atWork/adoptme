/**
 * make-icons.mjs — the Mini Games icons as tiny PNGs (no emoji; same approach
 * as scripts/pet-cards/make-icons.mjs and scripts/role-badges/make-role-icons.mjs).
 *
 *   node scripts/mini-games/make-icons.mjs
 *
 *   controller  Home tab "Mini Games" card and the Game Hub header
 *   ice         Ice Breaker     (frozen pet reveal)
 *   quiz        Pet Quiz        (Daily Quiz)
 *   memory      Memory Match    (pet pairs)
 *   scramble    Word Scramble   (letter tiles)
 *   arrow       Arrow Puzzle    (slide the arrows out)
 *   battle      Quiz Battle     (2 players: two question bubbles and a bolt)
 *   showdown    Trade Showdown  (2 players: a balance weighing two pets)
 *
 * Glossy toy style to sit next to the assets/home-actions art: soft gradients,
 * a white gloss, a soft dark outline so they read on light and dark cards.
 * Writes assets/mini-games/<name>.png, @2x and @3x at a 48 pt base.
 * Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// MINI_GAMES_ICONS_OUT lets a draft go to a scratch folder before it replaces the assets.
const OUT = process.env.MINI_GAMES_ICONS_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/mini-games');
const BASE = 48;
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

/** A rounded letter tile; the letter is drawn as strokes, never a font glyph. */
const tile = (x, y, rot, letter) => `
  <g transform="rotate(${rot} ${x + 10} ${y + 10})">
    <rect x="${x}" y="${y + 2}" width="20" height="20" rx="5" fill="#92400E"/>
    <rect x="${x}" y="${y}" width="20" height="20" rx="5" fill="url(#amber)" stroke="${OUTLINE}" stroke-width="1.2"/>
    <rect x="${x + 3}" y="${y + 2.5}" width="14" height="4" rx="2" fill="rgba(255,255,255,0.45)"/>
    <g transform="translate(${x} ${y})" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${letter}</g>
  </g>`;
const LETTER = {
  A: '<path d="M5.5 16 L10 4.5 L14.5 16 M7.3 11.6 H12.7"/>',
  B: '<path d="M6.5 4.5 V15.5 H11.2 C15.2 15.5 15.2 10 11.2 10 H6.5 M6.5 10 H10.6 C14 10 14 4.5 10.6 4.5 H6.5"/>',
  C: '<path d="M14.6 6.2 C12.6 3.8 6 4 6 10 C6 16 12.6 16.2 14.6 13.8"/>',
};

/** One arrow cell for the arrow-puzzle grid; dir is the rotation in degrees (0 = right). */
const arrowCell = (cx, cy, dir, fill) => `
  <g transform="rotate(${dir} ${cx} ${cy})">
    <path d="M${cx - 6} ${cy - 2} H${cx + 1} V${cy - 6} L${cx + 7} ${cy} L${cx + 1} ${cy + 6} V${cy + 2} H${cx - 6} Z"
          fill="${fill}" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" stroke-linejoin="round"/>
  </g>`;

const ICONS = {
  // A violet game pad: white d-pad, four candy buttons, a sparkle.
  controller: svg(
    grad('pad', [[0, '#DDD6FE'], [0.45, '#8B5CF6'], [1, '#4C1D95']]),
    `<path d="M15 21 C8.5 21 5 29 5 38 C5 47 8 52.5 13.5 52.5 C18 52.5 19.5 48.5 22.5 45.5 H41.5 C44.5 48.5 46 52.5 50.5 52.5 C56 52.5 59 47 59 38 C59 29 55.5 21 49 21 Z"
           fill="url(#pad)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M15.5 24 C11 24 9 28 8.6 32 C16 27.5 48 27.5 55.4 32 C55 28 53 24 48.5 24 Z" fill="rgba(255,255,255,0.35)"/>
     <g fill="#FFFFFF" stroke="${OUTLINE}" stroke-width="1">
       <rect x="16.2" y="30" width="5.6" height="15" rx="1.6"/>
       <rect x="11.5" y="34.7" width="15" height="5.6" rx="1.6"/>
     </g>
     <rect x="16.8" y="35.3" width="4.4" height="4.4" fill="#FFFFFF"/>
     <circle cx="45" cy="31" r="3.4" fill="#F472B6" stroke="${OUTLINE}" stroke-width="0.9"/>
     <circle cx="50.5" cy="36.5" r="3.4" fill="#FBBF24" stroke="${OUTLINE}" stroke-width="0.9"/>
     <circle cx="45" cy="42" r="3.4" fill="#34D399" stroke="${OUTLINE}" stroke-width="0.9"/>
     <circle cx="39.5" cy="36.5" r="3.4" fill="#38BDF8" stroke="${OUTLINE}" stroke-width="0.9"/>
     <g fill="rgba(255,255,255,0.8)"><circle cx="44" cy="30" r="1"/><circle cx="49.5" cy="35.5" r="1"/><circle cx="44" cy="41" r="1"/><circle cx="38.5" cy="35.5" r="1"/></g>
     ${sparkle(53, 12, 6, '#FDE68A')}${sparkle(11, 13, 3.5, '#FFFFFF')}`),

  // An ice cube with a paw frozen inside and a crack across one corner.
  ice: svg(
    grad('ice', [[0, '#F0FBFF'], [0.5, '#7DD3FC'], [1, '#0284C7']]) + grad('iceTop', [[0, '#FFFFFF'], [1, '#BAE6FD']]) + grad('iceSide', [[0, '#7DD3FC'], [1, '#0369A1']]),
    `<path d="M10 21 L20 12 H54 L44 21 Z" fill="url(#iceTop)" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>
     <path d="M44 21 L54 12 V46 L44 55 Z" fill="url(#iceSide)" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>
     <rect x="10" y="21" width="34" height="34" rx="3" fill="url(#ice)" stroke="${OUTLINE}" stroke-width="1.5"/>
     ${paw(27.5, 40, 0.95, 'rgba(7,89,133,0.55)')}
     <path d="M44 22.5 L37.5 27 L40 31 L34 34" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
     <rect x="13.5" y="24.5" width="4" height="13" rx="2" fill="rgba(255,255,255,0.75)"/>
     <rect x="13.5" y="40" width="4" height="4" rx="2" fill="rgba(255,255,255,0.6)"/>
     ${sparkle(55, 53, 5, '#7DD3FC')}${sparkle(8, 9, 4, '#BAE6FD')}`),

  // A violet speech bubble with a white question mark.
  quiz: svg(
    grad('bubble', [[0, '#E9D5FF'], [0.45, '#A855F7'], [1, '#6B21A8']]),
    `<path d="M20 8 H44 C52 8 57 13 57 21 V35 C57 43 52 48 44 48 H27 L15 57 L18 47.5 C11 46 7 41.5 7 35 V21 C7 13 12 8 20 8 Z"
           fill="url(#bubble)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M20 11 H44 C50 11 53.5 14 54 19 C44 15.5 20 15.5 10 19 C10.5 14 14 11 20 11 Z" fill="rgba(255,255,255,0.35)"/>
     <path d="M24.5 23.5 C24.5 16.5 39.5 15.5 39.5 23.5 C39.5 29 32 29.5 32 35.5" fill="none" stroke="rgba(59,7,100,0.35)" stroke-width="6.5" stroke-linecap="round" transform="translate(0 1.4)"/>
     <path d="M24.5 23.5 C24.5 16.5 39.5 15.5 39.5 23.5 C39.5 29 32 29.5 32 35.5" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round"/>
     <circle cx="32" cy="43.5" r="3.6" fill="#FFFFFF"/>
     ${sparkle(56, 9, 5, '#FDE68A')}`),

  // Two cards: a teal card back and a face-up card with a paw.
  memory: svg(
    grad('back', [[0, '#99F6E4'], [0.5, '#14B8A6'], [1, '#115E59']]) + grad('face', [[0, '#FFFFFF'], [1, '#D1FAE5']]),
    `<g transform="rotate(-14 24 34)">
       <rect x="9" y="14" width="28" height="38" rx="5" fill="url(#back)" stroke="${OUTLINE}" stroke-width="1.4"/>
       <rect x="13" y="18" width="20" height="30" rx="3" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.4"/>
       <path d="M23 25 L28 33 L23 41 L18 33 Z" fill="rgba(255,255,255,0.75)"/>
     </g>
     <g transform="rotate(10 41 33)">
       <rect x="27" y="12" width="28" height="38" rx="5" fill="url(#face)" stroke="${OUTLINE}" stroke-width="1.4"/>
       ${paw(41, 32, 0.78, '#10B981')}
     </g>
     ${sparkle(55, 53, 5, '#FDE68A')}`),

  // Three amber letter tiles, slightly jumbled.
  scramble: svg(
    grad('amber', [[0, '#FEF3C7'], [0.45, '#F59E0B'], [1, '#B45309']]),
    `${tile(4, 30, -12, LETTER.C)}${tile(22, 14, 6, LETTER.A)}${tile(40, 32, 10, LETTER.B)}
     ${sparkle(12, 13, 5, '#FDE68A')}${sparkle(55, 13, 3.5, '#FFFFFF')}`),

  // A navy board with four coloured arrows pointing different ways.
  arrow: svg(
    grad('board', [[0, '#475569'], [1, '#0F172A']]),
    `<rect x="7" y="7" width="50" height="50" rx="11" fill="url(#board)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M12 10 H52 C54 10 54.5 12 54 14 C40 11 24 11 10 14 C9.5 12 10 10 12 10 Z" fill="rgba(255,255,255,0.18)"/>
     <g fill="rgba(255,255,255,0.08)">
       <rect x="12" y="12" width="18" height="18" rx="4"/><rect x="34" y="12" width="18" height="18" rx="4"/>
       <rect x="12" y="34" width="18" height="18" rx="4"/><rect x="34" y="34" width="18" height="18" rx="4"/>
     </g>
     ${arrowCell(21, 21, 0, '#60A5FA')}${arrowCell(43, 21, 90, '#F472B6')}
     ${arrowCell(21, 43, 270, '#FBBF24')}${arrowCell(43, 43, 180, '#34D399')}
     ${sparkle(55, 8, 5, '#FDE68A')}`),

  // Two question bubbles facing off, a lightning bolt between them.
  battle: svg(
    grad('bubL', [[0, '#E9D5FF'], [0.45, '#A855F7'], [1, '#6B21A8']]) + grad('bubR', [[0, '#BAE6FD'], [0.45, '#3B82F6'], [1, '#1E3A8A']]) + grad('bolt', [[0, '#FEF08A'], [1, '#F59E0B']]),
    `<path d="M8 18 C8 13 11 10 16 10 H28 C33 10 36 13 36 18 V30 C36 35 33 38 28 38 H18 L11 45 L12.5 37.2 C9.6 36 8 33.5 8 30 Z"
           fill="url(#bubL)" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>
     <path d="M56 32 C56 27 53 24 48 24 H36 C31 24 28 27 28 32 V44 C28 49 31 52 36 52 H46 L53 59 L51.5 51.2 C54.4 50 56 47.5 56 44 Z"
           fill="url(#bubR)" stroke="${OUTLINE}" stroke-width="1.5" stroke-linejoin="round"/>
     <path d="M17 19.5 C17 14.5 27 14 27 19.5 C27 23 22 23.5 22 27.5" fill="none" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/>
     <circle cx="22" cy="32.4" r="2.4" fill="#FFFFFF"/>
     <path d="M37 33.5 C37 28.5 47 28 47 33.5 C47 37 42 37.5 42 41.5" fill="none" stroke="#FFFFFF" stroke-width="4.2" stroke-linecap="round"/>
     <circle cx="42" cy="46.4" r="2.4" fill="#FFFFFF"/>
     <path d="M36 2.5 L28.5 15.5 H33.5 L29.5 25 L39.5 11 H34 Z" fill="url(#bolt)" stroke="${OUTLINE}" stroke-width="1.2" stroke-linejoin="round"/>`),

  // A gold balance tipping between a blue paw and a pink paw.
  showdown: svg(
    grad('gold', [[0, '#FEF3C7'], [0.45, '#F59E0B'], [1, '#B45309']]) + grad('panL', [[0, '#BFDBFE'], [1, '#2563EB']]) + grad('panR', [[0, '#FBCFE8'], [1, '#DB2777']]),
    `<rect x="29.5" y="14" width="5" height="38" rx="2" fill="url(#gold)" stroke="${OUTLINE}" stroke-width="1.2"/>
     <path d="M20 57 H44 C44 52 40 50 32 50 C24 50 20 52 20 57 Z" fill="url(#gold)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
     <g transform="rotate(-10 32 16)">
       <rect x="8" y="14" width="48" height="4.5" rx="2.2" fill="url(#gold)" stroke="${OUTLINE}" stroke-width="1.2"/>
       <path d="M12 18 L6 34 M12 18 L18 34" stroke="#92400E" stroke-width="1.3"/>
       <path d="M52 18 L46 34 M52 18 L58 34" stroke="#92400E" stroke-width="1.3"/>
       <path d="M3 34 H21 C21 40 17 43 12 43 C7 43 3 40 3 34 Z" fill="url(#panL)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
       <path d="M43 34 H61 C61 40 57 43 52 43 C47 43 43 40 43 34 Z" fill="url(#panR)" stroke="${OUTLINE}" stroke-width="1.3" stroke-linejoin="round"/>
       ${paw(12, 29, 0.48, '#2563EB')}
       ${paw(52, 29, 0.48, '#DB2777')}
     </g>
     <circle cx="32" cy="12.5" r="4.2" fill="url(#gold)" stroke="${OUTLINE}" stroke-width="1.2"/>
     ${sparkle(56, 8, 4.5, '#FDE68A')}`),
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
