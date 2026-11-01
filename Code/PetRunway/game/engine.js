// ---------- Card engine: one SVG (600x800) per card ----------
const CW = 600, CH = 800, PET_PX = 440;
const SLOTS_ORDER = ['back', 'front'];
let cardSeq = 0;

// Pet art comes from the Pet Cards CDN (the phone caches it, 30-day cache headers, CORS open so the
// picture can be saved). ANCHORS = { key: { name, kind, head|eyes|cheeks|neck|body|hand: [x, y, w] } }
// as fractions of the 512 px art, made by scripts/pet-runway/anchors.py.
const PET_CDN = 'https://cardspull.b-cdn.net/v1/pets/512/';
const PET_URL = k => PET_CDN + k + '.webp';
// Pets the demo was tuned on come first in the picker, the rest by name.
const FEATURED = ['arcticfox', 'giantpanda', 'axolotl', 'bunny', 'cat', 'aurorafox', 'alicorn', 'kitsune', 'frostdragon', 'batdragon', 'giraffe', 'owl', 'parrot', 'koala', 'hamster', 'corgi', 'dalmatian', 'fennecfox', 'candyhare', 'ghostbunny', 'pinkdog', 'prettypony', 'toypoodle', 'turtle', 'strawberrypenguin', 'lattekitsune', 'kittybat', 'lamb', 'moonrabbit', 'peachowl', 'raccoon', 'goldenunicorn', 'balloonunicorn', 'cupiddragon', 'chick', 'kangaroo', 'hedgehog', 'frog'];
const PET_IDS = [...FEATURED.filter(k => ANCHORS[k]), ...Object.keys(ANCHORS).filter(k => !FEATURED.includes(k)).sort((x, y) => ANCHORS[x].name.localeCompare(ANCHORS[y].name))];
const PET_NAME = k => (ANCHORS[k] && ANCHORS[k].name) || k;
// Pictures the player added (private, kept by the app): id -> data URI.
const PHOTOS = {};

function anchorOf(look, slot) {
  const pet = look.pet, an = ANCHORS[pet.id] || ANCHORS.arcticfox, a = an[slot] || an.body, f = pet.flip ? -1 : 1;
  return { x: pet.x + f * (a[0] - .5) * PET_PX * pet.s, y: pet.y + (a[1] - .5) * PET_PX * pet.s, w: a[2] * PET_PX * pet.s };
}
function geom(look, st) {
  const it = ITEM[st.id], pf = st.slot && look.pet.flip;
  let x, y, w;
  if (st.slot) {
    const A = anchorOf(look, st.slot), f = look.pet.flip ? -1 : 1;
    w = A.w * (it.wm || 1) * st.s; x = A.x + f * st.ox * look.pet.s; y = A.y + st.oy * look.pet.s;
  } else { x = st.x; y = st.y; w = (it.fw || 100) * st.s; }
  const h = w * it.vb[1] / it.vb[0];
  return { x, y, w, h, ax: it.ax ?? .5, ay: it.ay ?? .5, r: (st.r || 0) * (pf ? -1 : 1), flip: (st.flip ? -1 : 1) * (pf ? -1 : 1) };
}
const gTransform = g => `translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) rotate(${g.r.toFixed(1)}) scale(${g.flip} 1)`;
function paintOf(st, idp) {
  if (st.id === 'photo') return { p: {}, def: '' };
  const it = ITEM[st.id], fill = st.fill || { mode: 'solid' }, c = fill.c1 || it.c, a = fill.c2 || it.a;
  const mode = fill.mode || 'solid', id = `${idp}f${st.k}`;
  const p = { c, a, d: shade(c, c === '#FFFFFF' || c === '#FFE9A8' ? -.28 : -.38), s: shade(c, -.14), l: shade(c, .45), m: mode === 'solid' ? c : `url(#${id})` };
  return { p, def: mode === 'solid' ? '' : fillDef(id, mode, c, a) };
}
// A picture the player added: cropped to a shape, with an optional sticker outline.
const PHOTO_SHAPES = {
  square: '<rect x="2" y="2" width="96" height="96" rx="14"/>',
  circle: '<circle cx="50" cy="50" r="48"/>',
  heart: `<path d="${heartD(50, 52, 3.2)}"/>`,
  star: `<polygon points="${starPts(50, 53, 50, 25)}"/>`,
};
function photoSVG(st, idp, opt) {
  const shape = PHOTO_SHAPES[st.shape] || PHOTO_SHAPES.square, id = `${idp}ph${st.k}`, src = PHOTOS[st.photo];
  const pic = src && !opt.publicView ? `<image href="${src}" width="100" height="100" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` : `<g clip-path="url(#${id})"><rect width="100" height="100" fill="#F3E3F7"/><path d="M30 64 L44 46 L54 58 L62 50 L74 64Z" fill="#D9C2FF"/><circle cx="64" cy="38" r="6" fill="#D9C2FF"/></g>`;
  const outline = st.outline === false ? '' : `<g fill="none" stroke="${st.outlineColor || '#FFFFFF'}" stroke-width="6" stroke-linejoin="round">${shape}</g>`;
  return `<defs><clipPath id="${id}">${shape}</clipPath></defs>${outline}${pic}`;
}
function stickerSVG(look, st, idp, opt = {}) {
  if (st.id === 'photo') {
    const g = geom(look, st);
    return `<g class="st" data-k="${st.k}" transform="${gTransform(g)}"><svg x="${(-g.ax * g.w).toFixed(1)}" y="${(-g.ay * g.h).toFixed(1)}" width="${g.w.toFixed(1)}" height="${g.h.toFixed(1)}" viewBox="0 0 100 100" overflow="visible">${photoSVG(st, idp, opt)}</svg></g>`;
  }
  const it = ITEM[st.id], g = geom(look, st), { p } = paintOf(st, idp);
  return `<g class="st" data-k="${st.k}" transform="${gTransform(g)}"><svg x="${(-g.ax * g.w).toFixed(1)}" y="${(-g.ay * g.h).toFixed(1)}" width="${g.w.toFixed(1)}" height="${g.h.toFixed(1)}" viewBox="0 0 ${it.vb[0]} ${it.vb[1]}" overflow="visible">${it.svg(p)}</svg></g>`;
}

function petFilterDef(pet, idp) {
  let d = '';
  if (pet.hue || pet.sat !== 100 || pet.bri !== 100) {
    const b = pet.bri / 100;
    d += `<filter id="${idp}pf" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="${pet.hue}"/><feColorMatrix type="saturate" values="${pet.sat / 100}"/><feComponentTransfer><feFuncR type="linear" slope="${b}"/><feFuncG type="linear" slope="${b}"/><feFuncB type="linear" slope="${b}"/></feComponentTransfer></filter>`;
  }
  const g = pet.glow;
  if (g === 'neon' || g === 'mega') {
    const flood = g === 'mega' ? `<feFlood flood-color="#FF4F9A"><animate attributeName="flood-color" values="#FF4F9A;#FFC94A;#5FD3B0;#6EC6FF;#B58CFF;#FF4F9A" dur="3s" repeatCount="indefinite"/></feFlood>` : `<feFlood flood-color="${pet.glowColor}"/>`;
    d += `<filter id="${idp}gl" x="-30%" y="-30%" width="160%" height="160%">${flood}<feComposite in2="SourceAlpha" operator="in"/><feMorphology operator="dilate" radius="5"/><feGaussianBlur stdDeviation="9"/></filter>`;
  }
  if (g === 'outline') d += `<filter id="${idp}gl" x="-20%" y="-20%" width="140%" height="140%"><feFlood flood-color="${pet.glowColor}"/><feComposite in2="SourceAlpha" operator="in"/><feMorphology operator="dilate" radius="7"/><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#3A1238" flood-opacity=".35"/></filter>`;
  if (g === 'ghost') d += `<filter id="${idp}gl" x="-30%" y="-30%" width="160%" height="160%"><feFlood flood-color="${pet.glowColor}"/><feComposite in2="SourceAlpha" operator="in"/><feGaussianBlur stdDeviation="14"/></filter>`;
  return d;
}
function petSVG(look, idp, opt = {}) {
  const pet = look.pet, f = pet.flip ? -1 : 1, url = opt.petData || PET_URL(pet.id), half = PET_PX / 2;
  const img = (extra = '') => `<image href="${url}" x="${-half}" y="${-half}" width="${PET_PX}" height="${PET_PX}" ${extra}/>`;
  let s = `<g class="pet" data-role="pet" transform="translate(${pet.x.toFixed(1)} ${pet.y.toFixed(1)}) scale(${(f * pet.s).toFixed(3)} ${pet.s.toFixed(3)})">`;
  if (pet.shadow) s += `<ellipse cx="0" cy="${half * .86}" rx="${half * .6}" ry="${half * .09}" fill="#2A0E2A" opacity=".22"/>`;
  if (pet.glow === 'neon' || pet.glow === 'mega') s += `<g>${img(`filter="url(#${idp}gl)"`)}<animate attributeName="opacity" values=".55;1;.55" dur="2.2s" repeatCount="indefinite"/></g>`;
  if (pet.glow === 'outline' || pet.glow === 'ghost') s += img(`filter="url(#${idp}gl)"`);
  s += `<g opacity="${pet.glow === 'ghost' ? .78 : 1}">${img(pet.hue || pet.sat !== 100 || pet.bri !== 100 ? `filter="url(#${idp}pf)"` : '')}</g>`;
  if (pet.glow === 'aura') {
    const r = mulberry(9);
    for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283 + r() * .3, d = half * (.62 + r() * .2); s += `<g transform="translate(${(Math.cos(a) * d).toFixed(1)} ${(Math.sin(a) * d * .9).toFixed(1)})"><path class="pa twinkle" style="animation-delay:${(-r() * 3).toFixed(2)}s;animation-duration:${(2 + r() * 2).toFixed(2)}s" d="${sparkD(0, 0, 9 + r() * 9)}" fill="${pet.glowColor}"/></g>`; }
  }
  return s + '</g>';
}

function fxSVG(look, still) {
  let s = '';
  (look.fx || []).forEach((k, n) => {
    const f = FX[k]; if (!f) return;
    const r = mulberry(31 + n * 101 + k.length);
    for (let i = 0; i < f.n; i++) {
      const size = f.size[0] + r() * (f.size[1] - f.size[0]), x = r() * CW, dur = (f.anim === 'fall' ? 6 : f.anim === 'rise' ? 7 : f.anim === 'flutter' ? 8 : 3) + r() * 4;
      const y = still ? 40 + r() * (CH - 160) : f.anim === 'fall' ? -40 : f.anim === 'rise' ? CH + 40 : 40 + r() * (CH - 120);
      const sx = ((r() - .5) * 160).toFixed(0), rot = ((r() - .5) * 720).toFixed(0);
      s += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})"><g class="pa ${f.anim}" style="--sx:${sx}px;--rot:${rot}deg;animation-duration:${dur.toFixed(1)}s;animation-delay:${(-r() * dur).toFixed(1)}s"><g transform="scale(${(size / 20).toFixed(2)})">${f.shape(i)}</g></g></g>`;
    }
  });
  return s;
}

function patternSVG(look, idp) {
  const pt = look.pattern; if (!pt || pt.id === 'none') return '';
  const P = PATTERNS[pt.id];
  return `<defs><pattern id="${idp}pt" width="${P.size}" height="${P.size}" patternUnits="userSpaceOnUse"${P.rot ? ` patternTransform="rotate(${P.rot})"` : ''}>${P.def(pt.color)}</pattern></defs><rect width="${CW}" height="${CH}" fill="url(#${idp}pt)" opacity="${pt.opacity}"/>`;
}

function strokeSVG(st, idp) {
  const pts = st.pts; if (!pts.length) return '';
  const path = () => { if (pts.length < 3) return `M${pts[0][0]} ${pts[0][1]} L${pts[pts.length - 1][0] + .1} ${pts[pts.length - 1][1]}`; let d = `M${pts[0][0]} ${pts[0][1]}`; for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]} ${pts[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`; } return d; };
  const base = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  switch (st.brush) {
    case 'marker': return `<path d="${path()}" stroke="${st.color}" stroke-width="${st.size * 2.4}" opacity=".5" ${base}/>`;
    case 'neon': return `<path d="${path()}" stroke="${st.color}" stroke-width="${st.size * 2.2}" filter="url(#${idp}blur)" ${base}/><path d="${path()}" stroke="#fff" stroke-width="${Math.max(2, st.size * .45)}" ${base}/>`;
    case 'rainbow': { let s = ''; for (let i = 1; i < pts.length; i++) s += `<line x1="${pts[i - 1][0]}" y1="${pts[i - 1][1]}" x2="${pts[i][0]}" y2="${pts[i][1]}" stroke="hsl(${(i * 9) % 360} 95% 65%)" stroke-width="${st.size}" stroke-linecap="round"/>`; return s; }
    case 'glitter': { let s = `<path d="${path()}" stroke="${st.color}" stroke-width="${st.size}" stroke-dasharray="0.1 ${st.size * 1.6}" ${base}/>`; pts.forEach((p, i) => { if (i % 4 === 2) s += `<path d="${sparkD(p[0], p[1], st.size * .9)}" fill="#fff"/>`; }); return s; }
    case 'hearts': case 'stars': { let s = '', acc = 0; for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc > st.size * 2.6 || i === 1) { acc = 0; const [x, y] = pts[i]; s += st.brush === 'hearts' ? `<path d="${heartD(x, y, st.size / 22)}" fill="${st.color}" stroke="#fff" stroke-width="1.5"/>` : `<polygon points="${starPts(x, y, st.size * .9, st.size * .4)}" fill="${st.color}" stroke="#fff" stroke-width="1.5"/>`; } } return s; }
    default: return `<path d="${path()}" stroke="${st.color}" stroke-width="${st.size}" ${base}/>`;
  }
}

const titleWords = t => [t.adj && T('adj_' + t.adj, t.adj), t.noun && T('noun_' + t.noun, t.noun)].filter(Boolean).join(' ');
function titleSVG(look, idp) {
  const t = look.title; if (!t || t.banner === 'none') return '';
  const text = esc(titleWords(t));
  const font = (FONT[t.font] || FONT.lilita).replace(/, (sans-serif|cursive)$/, ', ' + FALLBACK_FONT), em = { lilita: .5, pacifico: .56, cherry: .56, creep: .44, bungee: .74, chewy: .48 }[t.font] || .55;
  const fs = Math.min(52, 370 / (Math.max(6, text.length) * em)), y = 728;
  let band = '';
  if (t.banner === 'ribbon') band = `<path d="M96 698 H50 L68 732 L50 766 H96Z" fill="${shade(t.band, -.22)}"/><path d="M504 698 H550 L532 732 L550 766 H504Z" fill="${shade(t.band, -.22)}"/><path d="M96 760 L120 776 V760Z M504 760 L480 776 V760Z" fill="${shade(t.band, -.45)}"/><path d="M96 686 Q300 670 504 686 V760 Q300 744 96 760Z" fill="${t.band}" stroke="${shade(t.band, -.3)}" stroke-width="3"/>`;
  if (t.banner === 'pill') band = `<rect x="110" y="684" width="380" height="76" rx="38" fill="${t.band}" stroke="#fff" stroke-width="5"/>`;
  return `${band}<text x="300" y="${y + fs * .34}" text-anchor="middle" font-family="${font}" font-size="${fs}" fill="${t.color}" stroke="${t.outline}" stroke-width="${fs * .16}" paint-order="stroke" stroke-linejoin="round" letter-spacing="1">${text}</text>`;
}
function badgesSVG(look, opt) {
  let s = '';
  if (look.stamp) {
    const th = THEME_BY[look.theme] || THEMES[0], words = T('theme_' + th.id, th.name).split(' '), cut = Math.ceil(words.length / 2);
    const l1 = esc(words.slice(0, cut).join(' ')), l2 = esc(words.slice(cut).join(' ')), fs = Math.min(17, 150 / Math.max(l1.length, l2.length, 6));
    const st = STAMP_STYLES[look.stampStyle] || STAMP_STYLES.classic;
    s += `<g transform="translate(78 82) rotate(-12)"><circle r="46" fill="${st.bg}" stroke="#fff" stroke-width="4"/><circle r="38" fill="none" stroke="${st.ring}" stroke-width="2" stroke-dasharray="3 4"/><text y="${l2 ? -4 : 6}" text-anchor="middle" font-family="'Lilita One', ${FALLBACK_FONT}" font-size="${fs}" fill="${st.a}">${l1}</text>${l2 ? `<text y="${fs + 1}" text-anchor="middle" font-family="'Lilita One', ${FALLBACK_FONT}" font-size="${fs}" fill="${st.b}">${l2}</text>` : ''}</g>`;
  }
  if (opt.by) s += `<g transform="translate(498 64)"><rect x="-82" y="-22" width="164" height="44" rx="22" fill="rgba(58,18,56,.72)"/><text y="7" text-anchor="middle" font-family="${FALLBACK_FONT}" font-weight="900" font-size="${Math.min(19, 260 / Math.max(8, opt.by.length))}" fill="#fff">${esc(opt.by)}</text></g>`;
  return s;
}
function renderCard(look, opt = {}) {
  const idp = 'c' + (++cardSeq) + '_', sc = SCENES[look.scene.id] || SCENES.runway;
  let defs = `<clipPath id="${idp}clip"><rect width="${CW}" height="${CH}" rx="34"/></clipPath><filter id="${idp}blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>` + petFilterDef(look.pet, idp);
  for (const st of look.stickers) defs += paintOf(st, idp).def;
  const back = look.stickers.filter(s => s.back).map(s => stickerSVG(look, s, idp, opt)).join('');
  const front = look.stickers.filter(s => !s.back).map(s => stickerSVG(look, s, idp, opt)).join('');
  const fr = FRAMES[look.frame.id] || FRAMES.none;
  return `<svg class="card${opt.edit ? ' editing' : ''}" viewBox="0 0 ${CW} ${CH}" xmlns="http://www.w3.org/2000/svg" data-idp="${idp}"><defs>${defs}</defs>
<g clip-path="url(#${idp}clip)"><g class="lay-cam">
  <g class="lay-scene"><svg width="${CW}" height="${CH}" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice">${sc.svg(idp + 'sc', look.scene)}</svg>
  ${patternSVG(look, idp)}</g>
  <g class="lay-back">${back}</g>
  ${petSVG(look, idp, opt)}
  <g class="lay-front">${front}</g>
  <g class="lay-draw">${opt.publicView && look.drawShare !== 'share' ? '' : look.strokes.map(s => strokeSVG(s, idp)).join('')}</g>
  <g class="lay-fx" pointer-events="none">${fxSVG(look, opt.still)}</g>
</g></g>
<g pointer-events="none"><g class="lay-frame">${fr.svg(idp + 'fr', look.frame)}</g><g class="lay-title">${titleSVG(look, idp)}</g><g class="lay-badge">${badgesSVG(look, opt)}</g></g>
<g class="lay-sel"></g>
</svg>`;
}

// Theme fit: how many items, the scene, the effects and the title carry each tag; a theme scores its
// two tags, up to 4 each (drives the meter now, the demo scores before voting).
function lookTags(look) {
  const n = Object.fromEntries(TAG_LIST.map(t => [t, 0]));
  const add = tags => (tags || []).forEach(t => { if (t in n) n[t] += 1; });
  look.stickers.forEach(s => add((ITEM[s.id] || {}).tags));
  add((SCENES[look.scene.id] || {}).tags);
  (look.fx || []).forEach(k => add((FX[k] || {}).tags));
  if (look.pet.glow === 'ghost') add(['spooky']);
  if (look.pet.glow === 'mega' || look.pet.glow === 'aura') add(['magic']);
  if (look.title) [look.title.adj, look.title.noun].forEach(w => WORD_TAGS[w] && add([WORD_TAGS[w]]));
  return n;
}
const fitScore = (look, theme = THEME_BY[look.theme] || themeOfDay()) => { const t = lookTags(look); return theme.tags.reduce((sum, k) => sum + Math.min(t[k] || 0, 4), 0) / (4 * theme.tags.length); };
