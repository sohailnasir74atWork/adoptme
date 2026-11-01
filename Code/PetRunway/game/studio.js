// ---------- Studio: home, card editor, pictures, runway show, saving and sharing ----------
// Phase 1 (no server): cards, the draft and pictures are kept by the app per account (MMKV, see
// PetRunwayScreen.jsx); the page asks the app to store them through post().
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = o => JSON.parse(JSON.stringify(o));
const GLASSES = new Set(['heartglasses', 'starglasses', 'cateye', 'roundspecs', 'coolshades', 'mask']);
const groupOf = it => GLASSES.has(it.id) ? 'glasses' : ['hats', 'neck', 'wings'].includes(it.cat) ? it.cat : (it.id === 'tutu' || it.id === 'sash') ? 'body' : it.id === 'cape' ? 'cape' : null;
const MAX_CARDS = 30, MAX_PHOTOS = 12, PHOTO_MAX_BYTES = 120 * 1024, PHOTO_PX = 512;
const BY = INIT.nickname ? Tf('by_name', 'by {name}', { name: String(INIT.nickname).slice(0, 18) }) : '';

// ---------- looks ----------
const nextK = L => L.stickers.reduce((m, s) => Math.max(m, s.k), 0) + 1;
function resetOffset(L, st) {
  const it = ITEM[st.id], A = anchorOf(L, st.slot), off = it.off || [0, 0];
  st.ox = off[0] * A.w / L.pet.s; st.oy = off[1] * A.w / L.pet.s;
}
function makeSticker(L, id, fill) {
  const it = ITEM[id], st = { k: nextK(L), id, s: 1, r: 0, flip: false, back: !!it.back, fill: fill || { mode: 'solid', c1: it.c, c2: it.a } };
  if (it.slot) { st.slot = it.slot; resetOffset(L, st); }
  else { const n = L.stickers.filter(s => !s.slot).length; const spots = [[130, 170], [470, 170], [120, 560], [480, 560], [300, 130], [300, 600]]; [st.x, st.y] = spots[n % spots.length]; }
  return st;
}
function wear(L, id, fill) {
  const it = ITEM[id], g = groupOf(it);
  if (g) L.stickers = L.stickers.filter(s => groupOf(ITEM[s.id]) !== g);
  const st = makeSticker(L, id, fill); L.stickers.push(st); return st;
}
function starterLook() {
  const L = {
    pet: { id: 'arcticfox', x: 300, y: 430, s: 1, flip: false, hue: 0, sat: 100, bri: 100, glow: 'aura', glowColor: '#FFE27A', shadow: true },
    scene: { id: 'pumpkin', c1: '#FFB3D1', c2: '#B58CFF', style: 'vertical', floor: true },
    pattern: { id: 'none', color: '#FFFFFF', opacity: .22 },
    stickers: [], strokes: [], fx: ['sparkles'],
    frame: { id: 'gold', c: '#FFC94A', a: '#E0245E' },
    title: { adj: 'Spooky', noun: 'Cutie', font: 'cherry', color: '#FFFFFF', outline: '#3A1238', band: '#FF4F9A', banner: 'ribbon' },
    stamp: true, theme: themeOfDay().id,
  };
  stampToday(L);
  wear(L, 'batwings', { mode: 'glitter', c1: '#3A2350', c2: '#B58CFF' });
  wear(L, 'witch', { mode: 'solid', c1: '#7A4BD8', c2: '#FF6FAE' });
  wear(L, 'heartglasses', { mode: 'solid', c1: '#FF6FAE', c2: '#FFFFFF' });
  wear(L, 'pearls', { mode: 'solid', c1: '#FFFFFF', c2: '#FF6FAE' });
  wear(L, 'blush');
  const bat = makeSticker(L, 'd_bat'); bat.x = 478; bat.y = 160; bat.r = 12; L.stickers.push(bat);
  const c = makeSticker(L, 'd_candy'); c.x = 116; c.y = 590; c.s = .9; c.r = -18; L.stickers.push(c);
  return L;
}
// A card from storage is only used when everything in it still exists (items, scenes and pets can change between versions).
function validLook(L) {
  return !!(L && L.pet && ANCHORS[L.pet.id] && Array.isArray(L.stickers) && L.stickers.every(s => ITEM[s.id]) && L.scene && SCENES[L.scene.id] && Array.isArray(L.strokes) && Array.isArray(L.fx) && L.frame && FRAMES[L.frame.id] && L.title && L.pattern);
}

// ---------- state ----------
const S = {
  look: validLook(INIT.draft) ? INIT.draft : starterLook(),
  sel: null, tab: 'wear', wearCat: 'hats', stickCat: 'decor', mode: 'move',
  brush: { type: 'pen', color: '#FF4F9A', size: 10 },
  hist: [], hi: -1, editing: -1,
  cards: (Array.isArray(INIT.cards) ? INIT.cards : []).filter(c => c && validLook(c.look)).slice(0, MAX_CARDS),
  photos: [], // ids, newest first; the data arrives from the app after the page loads (setPhotos)
};
let draftTimer = 0;
function saveDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(() => post({ type: 'save_draft', look: S.look }), 600); }
function saveCards() { post({ type: 'save_cards', cards: S.cards }); }
function commit() {
  S.hist = S.hist.slice(0, S.hi + 1); S.hist.push(JSON.stringify(S.look));
  if (S.hist.length > 60) S.hist.shift(); S.hi = S.hist.length - 1;
  saveDraft(); updateUndo();
}
function updateUndo() { $('#undoBtn').disabled = S.hi <= 0; $('#redoBtn').disabled = S.hi >= S.hist.length - 1; }
function undoTo(i) { if (i < 0 || i >= S.hist.length) return; S.hi = i; S.look = JSON.parse(S.hist[i]); S.sel = null; saveDraft(); drawCard(); renderPanel(); updateUndo(); }
$('#undoBtn').onclick = () => undoTo(S.hi - 1);
$('#redoBtn').onclick = () => undoTo(S.hi + 1);
const findSt = k => S.look.stickers.find(s => s.k === k);
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#app').appendChild(t); setTimeout(() => t.remove(), 2100); }

// ---------- navigation ----------
// The app shows its banner only on this page's home screen (never in the studio, where fingers drag
// and draw, nor over the show or Magic), so every screen change is reported.
let screen = 'home';
const layerNow = () => (!$('#magic').hidden ? 'magic' : !$('#show').hidden ? 'show' : screen);
const reportScreen = () => post({ type: 'screen', name: layerNow() });
function go(name) {
  screen = name;
  reportScreen();
  for (const s of $$('.screen')) s.hidden = s.id !== 'scr-' + name;
  if (name === 'home') renderHome();
  if (name === 'studio') { drawCard(); renderTabs(); renderPanel(); updateUndo(); }
  window.scrollTo({ top: 0 });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { if (b.dataset.go === 'studio' && screen === 'home') { S.editing = -1; } go(b.dataset.go); } });
$('#exitBtn').onclick = () => post({ type: 'exit' });

// ---------- home ----------
// The scene behind the home card follows the theme's first tag.
const TAG_SCENE = { spooky: 'pumpkin', winter: 'snow', candy: 'candy', ocean: 'ocean', royal: 'ballroom', nature: 'sakura', magic: 'starry', party: 'disco', cute: 'rainbow' };
const fmtDay = iso => { try { return new Date(iso + 'T00:00:00Z').toLocaleDateString(INIT.lang || undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch (_) { return iso; } };
let homeScene = '';
function renderHome() {
  const th = themeOn(), ev = th.event;
  $('#themeName').textContent = T('theme_' + th.id, th.name);
  $('#ideaLabel').textContent = ev ? T('event_label', 'Event') : T('idea_label', "Today's idea");
  $('#themeHint').textContent = ev ? Tf('event_until', 'On until {date}. Featured items are marked with a star.', { date: fmtDay(ev.ends_on) }) : T('idea_hint', 'Dress up any pet, pick a scene and a frame, draw on it, then press Magic.');
  const scene = (ev && ev.featured && (ev.featured.scenes || []).find(k => SCENES[k])) || TAG_SCENE[th.tags[0]] || 'pumpkin';
  if (scene !== homeScene) {
    homeScene = scene;
    $$('#themeCard > svg, #themeCard > .veil').forEach(n => n.remove());
    $('#themeCard').insertAdjacentHTML('afterbegin', `<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMax slice">${SCENES[scene].svg('home', { c1: '#FFB3D1', c2: '#B58CFF', style: 'vertical' })}</svg><div class="veil"></div>`);
  }
  $('#themeCard').style.boxShadow = ev && ev.style && /^#[0-9A-F]{6}$/.test(ev.style.banner || '') ? `0 0 0 4px ${ev.style.banner}` : '';
  const days = [1, 2, 3].map(d => { const t = themeOn(Date.now() + d * 864e5); return `<div class="next"><span>${esc(dayName(d))}${t.event ? ' · ' + esc(T('event_label', 'Event')) : ''}</span><b>${esc(T('theme_' + t.id, t.name))}</b></div>`; });
  $('#nextThemes').innerHTML = days.join('');
  $('#staffRow').hidden = !INIT.staff;
  $('#myCount').textContent = S.cards.length ? Tf('saved_count', '{n} saved', { n: S.cards.length }) : '';
  $('#myCards').innerHTML = S.cards.length
    ? S.cards.map((c, i) => `<div><button class="open" data-open="${i}" aria-label="${esc(T('open_card', 'Open card'))}">${renderCard(c.look)}</button><button class="del" data-del="${i}" aria-label="${esc(T('delete', 'Delete'))}">×</button></div>`).join('')
    : `<div class="empty-cards" style="flex:1">${esc(T('cards_empty', 'Cards you save from the runway show up here.'))}</div>`;
}
// A new card (and the draft) is about today's theme; a saved card keeps the theme it was made for.
function stampToday(L) {
  const th = themeOn();
  L.theme = th.id;
  L.stampStyle = th.event && th.event.style && STAMP_STYLES[th.event.style.stamp] ? th.event.style.stamp : 'classic';
}
$('#staffBtn').onclick = () => post({ type: 'open_events' });
const dayName = d => { try { return new Date(Date.now() + d * 864e5).toLocaleDateString(INIT.lang || undefined, { weekday: 'long', timeZone: 'UTC' }); } catch (_) { return ''; } };
$('#myCards').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!del.classList.contains('sure')) { del.classList.add('sure'); del.textContent = T('delete_sure', 'Delete?'); setTimeout(() => { if (del.isConnected) { del.classList.remove('sure'); del.textContent = '×'; } }, 2500); return; }
    S.cards.splice(+del.dataset.del, 1); saveCards(); renderHome(); return;
  }
  const b = e.target.closest('[data-open]'); if (!b) return;
  S.editing = +b.dataset.open; S.look = clone(S.cards[S.editing].look); S.sel = null; commit(); go('studio');
});
function tick() {
  const now = new Date(), ev = eventOn(), end = ev ? Date.parse(ev.ends_on + 'T00:00:00Z') + 864e5 : Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const s = Math.max(0, Math.floor((end - now) / 1000)), d = Math.floor(s / 86400);
  const time = (d ? d + 'd ' : '') + [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':');
  $('#countdown').textContent = ev ? Tf('event_ends_in', 'Ends in {time}', { time }) : Tf('next_idea_in', 'New idea in {time}', { time });
}

// ---------- studio: card + direct manipulation ----------
const host = $('#cardHost');
function drawCard() {
  host.innerHTML = renderCard(S.look, { edit: true, by: BY });
  host.querySelector('svg').classList.toggle('draw', S.mode === 'draw');
  drawSel(); drawMeter();
}
// The meter: how well the card fits its theme's two tags.
const TAG_COLOR = { cute: '#FF4F9A', spooky: '#7A4BD8', winter: '#3F7BE0', candy: '#FF6FAE', royal: '#D9A72E', ocean: '#2BB5A0', nature: '#4FA36A', magic: '#B58CFF', party: '#FF9A3C' };
function drawMeter() {
  const th = THEME_BY[S.look.theme] || themeOfDay(), t = lookTags(S.look), m = fitScore(S.look, th);
  const dots = (n, c) => [0, 1, 2, 3].map(i => `<i style="${i < n ? `background:${c}` : ''}"></i>`).join('');
  $('#meter').innerHTML = `<div class="bars">${th.tags.map(k => `<span>${esc(T('tag_' + k, TAG_NAMES[k]))}${dots(Math.min(4, t[k] || 0), TAG_COLOR[k])}</span>`).join('')}</div><span>${esc(m >= .87 ? T('match_perfect', 'Perfect match') : m >= .6 ? T('match_great', 'Great match') : m >= .3 ? T('match_more', 'Add more theme items') : T('match_off', 'Off theme'))}</span>`;
}
function petBox() { const p = S.look.pet, h = PET_PX / 2 * p.s; return { x: p.x - h, y: p.y - h, w: h * 2, h: h * 2 }; }
const HANDLE = (x, y, act, fill, icon) => `<g data-h="${act}"><circle cx="${x}" cy="${y}" r="46" fill="transparent"/><circle cx="${x}" cy="${y}" r="26" fill="${fill}" stroke="#fff" stroke-width="4"/>${icon(x, y)}</g>`;
const IC_ROT = (x, y) => `<path d="M${x - 9} ${y + 3} a10 10 0 1 0 3 -10" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M${x - 9} ${y - 11} v8 h8" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const IC_SCALE = (x, y) => `<path d="M${x - 9} ${y - 9} L${x + 9} ${y + 9} M${x + 9} ${y} V${y + 9} H${x} M${x - 9} ${y} V${y - 9} H${x}" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const IC_DEL = (x, y) => `<path d="M${x - 8} ${y - 8} L${x + 8} ${y + 8} M${x + 8} ${y - 8} L${x - 8} ${y + 8}" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>`;
function drawSel() {
  const svg = host.querySelector('svg'); if (!svg) return;
  const lay = svg.querySelector('.lay-sel'); let s = '';
  if (S.sel && S.sel.type === 'st') {
    const st = findSt(S.sel.k);
    if (!st) S.sel = null;
    else {
      const g = geom(S.look, st), x0 = -g.ax * g.w - 12, y0 = -g.ay * g.h - 12, w = g.w + 24, h = g.h + 24;
      s = `<g transform="translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) rotate(${g.r.toFixed(1)})"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="12" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="14 9"/><rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="12" fill="none" stroke="#FF4F9A" stroke-width="2" stroke-dasharray="14 9"/><path d="M${x0 + w / 2} ${y0} V${y0 - 40}" stroke="#fff" stroke-width="4"/>${HANDLE(x0 + w / 2, y0 - 64, 'rot', '#7A4BD8', IC_ROT)}${HANDLE(x0 + w, y0 + h, 'scale', '#FF4F9A', IC_SCALE)}${HANDLE(x0, y0, 'del', '#C21E56', IC_DEL)}</g>`;
    }
  } else if (S.sel && S.sel.type === 'pet') {
    const b = petBox();
    s = `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="16" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="14 9"/><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="16" fill="none" stroke="#7A4BD8" stroke-width="2" stroke-dasharray="14 9"/>${HANDLE(b.x + b.w - 20, b.y + b.h - 20, 'scale', '#7A4BD8', IC_SCALE)}`;
  }
  lay.innerHTML = s;
}
function patch() {
  const svg = host.querySelector('svg'); if (!svg) return;
  const p = S.look.pet;
  svg.querySelector('[data-role="pet"]').setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${((p.flip ? -1 : 1) * p.s).toFixed(3)} ${p.s.toFixed(3)})`);
  for (const st of S.look.stickers) {
    const el = svg.querySelector(`.st[data-k="${st.k}"]`); if (!el) continue;
    const g = geom(S.look, st), inner = el.firstElementChild;
    el.setAttribute('transform', gTransform(g));
    inner.setAttribute('x', (-g.ax * g.w).toFixed(1)); inner.setAttribute('y', (-g.ay * g.h).toFixed(1));
    inner.setAttribute('width', g.w.toFixed(1)); inner.setAttribute('height', g.h.toFixed(1));
  }
  drawSel();
}
function svgPt(svg, e) { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); }
function select(sel) {
  S.sel = sel;
  if (sel && sel.type === 'pet') S.tab = 'pet';
  if (sel) post({ type: 'haptic', kind: 'light' });
  drawSel(); renderTabs(); renderPanel();
}
function deleteSel() {
  if (!S.sel || S.sel.type !== 'st') return;
  S.look.stickers = S.look.stickers.filter(s => s.k !== S.sel.k); S.sel = null;
  commit(); drawCard(); renderPanel();
}
let drag = null;
host.addEventListener('pointerdown', e => {
  const svg = host.querySelector('svg'); if (!svg) return;
  const pt = svgPt(svg, e);
  const cap = () => { try { host.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); };
  if (S.mode === 'draw') {
    const st = { brush: S.brush.type, color: S.brush.color, size: S.brush.size, pts: [[Math.round(pt.x), Math.round(pt.y)]] };
    S.look.strokes.push(st); drag = { type: 'draw', st }; liveStroke(); cap(); return;
  }
  const h = e.target.closest('[data-h]');
  if (h && S.sel) {
    const act = h.dataset.h;
    if (act === 'del') { deleteSel(); e.preventDefault(); return; }
    const st = S.sel.type === 'st' ? findSt(S.sel.k) : null;
    const c = st ? geom(S.look, st) : { x: S.look.pet.x, y: S.look.pet.y };
    drag = { type: act, st, c, d0: Math.hypot(pt.x - c.x, pt.y - c.y) || 1, s0: st ? st.s : S.look.pet.s };
    cap(); return;
  }
  const el = e.target.closest('.st');
  if (el) {
    const st = findSt(+el.dataset.k);
    if (!S.sel || S.sel.k !== st.k) select({ type: 'st', k: st.k });
    drag = { type: 'move', st, p0: pt, x0: st.slot ? st.ox : st.x, y0: st.slot ? st.oy : st.y }; cap(); return;
  }
  if (e.target.closest('[data-role="pet"]')) {
    if (!S.sel || S.sel.type !== 'pet') select({ type: 'pet' });
    drag = { type: 'pet', p0: pt, x0: S.look.pet.x, y0: S.look.pet.y }; cap(); return;
  }
  if (S.sel) select(null);
});
host.addEventListener('pointermove', e => {
  if (!drag) return;
  const svg = host.querySelector('svg'), pt = svgPt(svg, e), L = S.look;
  if (drag.type === 'draw') {
    const pts = drag.st.pts, last = pts[pts.length - 1];
    // A stroke keeps at most 400 points, so a card stays small enough to save and (later) to send.
    if (pts.length < 400 && Math.hypot(pt.x - last[0], pt.y - last[1]) > 4) { pts.push([Math.round(pt.x), Math.round(pt.y)]); liveStroke(); }
    return;
  }
  drag.moved = true;
  if (drag.type === 'move') {
    const st = drag.st, dx = pt.x - drag.p0.x, dy = pt.y - drag.p0.y;
    if (st.slot) { st.ox = drag.x0 + (L.pet.flip ? -1 : 1) * dx / L.pet.s; st.oy = drag.y0 + dy / L.pet.s; }
    else { st.x = clamp(drag.x0 + dx, 0, CW); st.y = clamp(drag.y0 + dy, 0, CH); }
  } else if (drag.type === 'pet') {
    L.pet.x = clamp(drag.x0 + pt.x - drag.p0.x, 40, CW - 40); L.pet.y = clamp(drag.y0 + pt.y - drag.p0.y, 80, CH - 40);
  } else if (drag.type === 'scale') {
    const k = Math.hypot(pt.x - drag.c.x, pt.y - drag.c.y) / drag.d0;
    if (drag.st) drag.st.s = clamp(drag.s0 * k, .25, 4); else L.pet.s = clamp(drag.s0 * k, .4, 1.8);
  } else if (drag.type === 'rot' && drag.st) {
    let a = Math.atan2(pt.y - drag.c.y, pt.x - drag.c.x) * 180 / Math.PI + 90;
    a = ((a + 540) % 360) - 180; if (Math.abs(a) < 6) a = 0;
    drag.st.r = drag.st.slot && L.pet.flip ? -a : a;
  }
  patch();
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.type === 'draw') {
    if (S.look.strokes.length > 60) S.look.strokes.shift(); // keep the newest 60 lines
    commit(); drawMeter(); return;
  }
  if (d.moved) { commit(); if (S.sel) renderPanel(); }
};
host.addEventListener('pointerup', endDrag);
host.addEventListener('pointercancel', endDrag);
function liveStroke() { const svg = host.querySelector('svg'); svg.querySelector('.lay-draw').innerHTML = S.look.strokes.map(s => strokeSVG(s, svg.dataset.idp)).join(''); }
function setMode(m) {
  S.mode = m;
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  const svg = host.querySelector('svg'); if (svg) svg.classList.toggle('draw', m === 'draw');
  if (m === 'draw') { S.sel = null; drawSel(); }
}
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b) return; setMode(b.dataset.mode); if (b.dataset.mode === 'draw') S.tab = 'draw'; else if (S.tab === 'draw') S.tab = 'wear'; renderTabs(); renderPanel(); });

// ---------- studio: tool panel ----------
const ICON = {
  pet: '<circle cx="7" cy="8" r="2.4"/><circle cx="12" cy="5.6" r="2.4"/><circle cx="17" cy="8" r="2.4"/><path d="M12 11 c4 0 6 4 5 6.5 c-1 2 -3 1.5 -5 1.5 s-4 .5 -5 -1.5 c-1 -2.5 1 -6.5 5 -6.5Z"/>',
  wear: '<path d="M3 17 L4 7 L8.5 11 L12 4 L15.5 11 L20 7 L21 17Z"/><rect x="3" y="17.5" width="18" height="2.5" rx="1"/>',
  stickers: `<polygon points="${starPts(12, 12.5, 9.5, 4.2)}"/>`,
  scene: '<path d="M2 19 L8.5 10 L13 15 L16 12 L22 19Z"/><circle cx="17" cy="6" r="2.5"/>',
  frame: '<path fill-rule="evenodd" d="M3 3 H21 V21 H3Z M7 7 V17 H17 V7Z"/>',
  title: '<path d="M4 5 H20 V9 H18 V7.5 H13.5 V18 H15.5 V20 H8.5 V18 H10.5 V7.5 H6 V9 H4Z"/>',
  draw: '<path d="M4 20 L5 15 L16 4 L20 8 L9 19Z"/><path d="M3 21 L5.5 20.2 L3.8 18.5Z"/>',
  fx: `<path d="${sparkD(9, 10, 7)}"/><path d="${sparkD(18, 17, 4)}"/><path d="${sparkD(18, 5, 3)}"/>`,
};
const TABS = [['pet', 'Pet'], ['wear', 'Wear'], ['stickers', 'Stickers'], ['scene', 'Scene'], ['frame', 'Frame'], ['title', 'Title'], ['draw', 'Draw'], ['fx', 'Effects']];
function renderTabs() { $('#tabs').innerHTML = TABS.map(([k, n]) => `<button class="tab ${S.tab === k && !(S.sel && S.sel.type === 'st') ? 'on' : ''}" data-tab="${k}"><svg viewBox="0 0 24 24" fill="currentColor">${ICON[k]}</svg>${esc(T('tab_' + k, n))}</button>`).join(''); }
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; S.sel = null; drawSel();
  setMode(S.tab === 'draw' ? 'draw' : 'move');
  renderTabs(); renderPanel();
});

const thumbP = it => ({ c: it.c, a: it.a, d: shade(it.c, it.c === '#FFFFFF' ? -.28 : -.38), s: shade(it.c, -.14), l: shade(it.c, .45), m: it.c });
const itemThumb = (it, p) => `<svg viewBox="0 0 ${it.vb[0]} ${it.vb[1]}" overflow="visible">${it.svg(p || thumbP(it))}</svg>`;
// A small dot when an item fits the card's theme (in that tag's colour).
const tagDot = tags => { const th = THEME_BY[S.look.theme] || themeOfDay(), k = th.tags.find(t => (tags || []).includes(t)); return k ? `<i class="tag" style="background:${TAG_COLOR[k]}"></i>` : ''; };
const chip = (attr, val, label, on, style = '') => `<button class="pchip ${on ? 'on' : ''}" ${attr}="${esc(val)}" ${style}>${esc(label)}</button>`;
const itemName = it => it.cat === 'words' ? T('word_' + it.id.slice(1), it.name) : T('item_' + it.id, it.name);
function swRow(key, cur) {
  const c = String(cur || '').toUpperCase();
  return `<div class="sw-row">${PALETTE.map(p => `<button class="sw ${p === c ? 'on' : ''}" style="background:${p}" data-sw="${key}" data-c="${p}" aria-label="${p}"></button>`).join('')}<label class="sw-custom"><input type="color" data-swc="${key}" value="${/^#[0-9A-F]{6}$/.test(c) ? c.toLowerCase() : '#ff4f9a'}" aria-label="${esc(T('any_colour', 'Any colour'))}"></label></div>`;
}
const range = (key, min, max, step, val, fmt = v => v, cls = '') => `<div class="range ${cls}"><input type="range" data-rg="${key}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${key}"><output>${fmt(val)}</output></div>`;
const toolBtn = (act, label, icon, cls = '') => `<button data-act="${act}" class="${cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${esc(label)}</button>`;
const lbl = (key, d, right = '') => `<div class="lbl">${esc(T(key, d))}${right ? `<span>${esc(right)}</span>` : ''}</div>`;
const fine = (key, d) => `<p class="fine" style="text-align:start">${esc(T(key, d))}</p>`;
const TI = {
  flip: '<path d="M12 3 V21 M9 6 L4 18 H9Z M15 6 L20 18 H15Z"/>', back: '<rect x="3" y="9" width="11" height="11" rx="2"/><rect x="10" y="4" width="11" height="11" rx="2" fill="currentColor" opacity=".25"/>',
  front: '<rect x="3" y="9" width="11" height="11" rx="2" fill="currentColor" opacity=".25"/><rect x="10" y="4" width="11" height="11" rx="2"/>', up: '<path d="M12 19 V5 M6 11 L12 5 L18 11"/>', down: '<path d="M12 5 V19 M6 13 L12 19 L18 13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8 V5 a1 1 0 0 0 -1 -1 H5 a1 1 0 0 0 -1 1 V15 a1 1 0 0 0 1 1 H8"/>', reset: '<path d="M4 12 a8 8 0 1 0 3 -6.2 M4 4 V9 H9"/>', del: '<path d="M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 20 H16 L17 7"/>',
  centre: '<circle cx="12" cy="12" r="3"/><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22"/>', shadow: '<ellipse cx="12" cy="18" rx="8" ry="2.5" fill="currentColor" opacity=".35"/><circle cx="12" cy="9" r="5"/>', undo: '<path d="M9 14 L4 9 L9 4 M4 9 H15 a5 5 0 0 1 0 10 H11"/>', stamp: '<circle cx="12" cy="12" r="8"/><path d="M8 12 H16"/>',
  outline: '<rect x="4" y="4" width="16" height="16" rx="4"/><rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="currentColor" opacity=".3"/>',
  plus: '<path d="M12 5 V19 M5 12 H19" stroke-width="3"/>',
};

function renderPanel() {
  const P = $('#panel'), L = S.look;
  if (S.sel && S.sel.type === 'st') { const st = findSt(S.sel.k); P.innerHTML = st.id === 'photo' ? photoEditor(st) : editorPanel(st); return; }
  switch (S.tab) {
    case 'pet': P.innerHTML = petPanel(L); break;
    case 'wear': P.innerHTML = itemsPanel(['hats', 'hair', 'face', 'neck', 'outfit', 'wings', 'hold'], S.wearCat, 'wcat', T('hint_wear', 'Tap to wear. Drag it on your pet, pull the pink corner to resize, turn it with the purple knob.')); break;
    case 'stickers': P.innerHTML = S.stickCat === 'photos' ? photosPanel() : itemsPanel(['decor', 'words', 'photos'], S.stickCat, 'scat', T('hint_stickers', 'Tap to add as many as you like. Drag them anywhere on the card.')); break;
    case 'scene': P.innerHTML = scenePanel(L); break;
    case 'frame': P.innerHTML = framePanel(L); break;
    case 'title': P.innerHTML = titlePanel(L); break;
    case 'draw': P.innerHTML = drawPanel(); break;
    case 'fx': P.innerHTML = fxPanel(L); break;
  }
}
const CAT_NAMES = Object.fromEntries([...CATS, ['photos', 'My pictures']]);
const catChips = (cats, cur, attr) => `<div class="chips scroll">${cats.map(c => chip('data-' + attr, c, T('cat_' + c, CAT_NAMES[c]), c === cur)).join('')}</div>`;
function petPanel(L) {
  const p = L.pet;
  return `${lbl('pick_pet', 'Pick a pet', Tf('pet_count', '{n} pets', { n: PET_IDS.length }))}
  <div class="grid g5">${PET_IDS.map(id => `<button class="tile pet ${p.id === id ? 'on' : ''}" data-pet="${id}"><div class="ico"><img src="${PET_URL(id)}" alt="" loading="lazy" decoding="async"></div><span>${esc(PET_NAME(id))}</span></button>`).join('')}</div>
  ${lbl('size', 'Size')}${range('petS', .5, 1.6, .02, p.s, v => Math.round(v * 100) + '%')}
  <div class="tools">${toolBtn('pflip', T('flip', 'Flip'), TI.flip)}${toolBtn('pshadow', T('shadow', 'Shadow'), TI.shadow, p.shadow ? 'on' : '')}${toolBtn('pcentre', T('centre', 'Centre'), TI.centre)}${toolBtn('preset', T('reset', 'Reset'), TI.reset)}</div>
  ${lbl('pet_colour', 'Pet colour')}<div class="chips">${PET_LOOKS.map((x, i) => chip('data-plook', i, T('look_' + i, x[0]), p.hue === x[1] && p.sat === x[2] && p.bri === x[3])).join('')}</div>
  ${lbl('hue', 'Hue')}${range('hue', 0, 359, 1, p.hue, v => v + '°', 'hue')}
  ${lbl('strength', 'Colour strength')}${range('sat', 0, 200, 1, p.sat, v => v + '%')}
  ${lbl('brightness', 'Brightness')}${range('bri', 40, 150, 1, p.bri, v => v + '%')}
  ${lbl('glow', 'Glow')}<div class="chips">${GLOWS.map(([k, n]) => chip('data-glow', k, T('glow_' + k, n), p.glow === k)).join('')}</div>
  ${p.glow !== 'none' && p.glow !== 'mega' ? `${lbl('glow_colour', 'Glow colour')}${swRow('glow', p.glowColor)}` : ''}`;
}
// Event featured items and scenes come first, with a star.
const featured = kind => { const ev = eventOn(); return new Set(ev && ev.featured && Array.isArray(ev.featured[kind]) ? ev.featured[kind] : []); };
const STAR_BADGE = `<svg class="feat" viewBox="0 0 20 20"><polygon points="${starPts(10, 10.5, 9, 4)}" fill="#FFC542" stroke="#fff" stroke-width="1.5"/></svg>`;
function itemsPanel(cats, cur, attr, hint) {
  const L = S.look, worn = new Set(L.stickers.map(s => s.id)), fi = featured('items');
  const list = ITEMS.filter(i => i.cat === cur).sort((a, b) => fi.has(b.id) - fi.has(a.id));
  return `${catChips(cats, cur, attr)}
  <div class="grid">${list.map(it => `<button class="tile ${worn.has(it.id) && it.slot ? 'on' : ''}" data-add="${it.id}">${fi.has(it.id) ? STAR_BADGE : tagDot(it.tags)}<div class="ico">${itemThumb(it)}</div><span>${esc(itemName(it))}</span></button>`).join('')}</div>
  <p class="fine" style="text-align:start">${esc(hint)}</p>`;
}
function photosPanel() {
  const add = `<button class="tile add" data-act="pickPhoto"><div class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="#FF4F9A" stroke-width="3" stroke-linecap="round"><path d="M12 5 V19 M5 12 H19"/></svg></div><span>${esc(T('add_picture', 'Add picture'))}</span></button>`;
  const tiles = S.photos.filter(id => PHOTOS[id]).map(id => `<button class="tile" data-photo="${id}"><span class="x" data-rmphoto="${id}" role="button" aria-label="${esc(T('delete', 'Delete'))}">×</span><div class="ico"><img src="${PHOTOS[id]}" alt="" style="object-fit:cover;border-radius:8px"></div><span>${esc(T('picture', 'Picture'))}</span></button>`).join('');
  return `${catChips(['decor', 'words', 'photos'], 'photos', 'scat')}
  <div class="grid">${add}${tiles}</div>
  ${fine('photos_private', 'Pictures stay private on this phone. Please do not add faces or anything personal.')}
  ${S.photos.length >= MAX_PHOTOS ? fine('photos_full', 'You can keep 12 pictures. Delete one to add another.') : ''}`;
}
function scenePanel(L) {
  const sc = L.scene, pt = L.pattern;
  return `${lbl('scene', 'Scene')}
  <div class="grid">${Object.entries(SCENES).sort(([a], [b]) => featured('scenes').has(b) - featured('scenes').has(a)).map(([k, s]) => `<button class="tile ${sc.id === k ? 'on' : ''}" data-scene="${k}">${featured('scenes').has(k) ? STAR_BADGE : tagDot(s.tags)}<div class="ico full" style="aspect-ratio:.75"><svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice">${s.svg('th' + k, sc)}</svg></div><span>${esc(T('scene_' + k, s.name))}</span></button>`).join('')}</div>
  ${sc.id === 'custom' ? `${lbl('top_colour', 'Top colour')}${swRow('sc1', sc.c1)}${lbl('bottom_colour', 'Bottom colour')}${swRow('sc2', sc.c2)}<div class="chips">${[['vertical', 'Top to bottom'], ['diagonal', 'Diagonal'], ['radial', 'Spotlight']].map(([k, n]) => chip('data-sstyle', k, T('style_' + k, n), sc.style === k)).join('')}${chip('data-sfloor', 1, T('floor', 'Floor'), sc.floor)}</div>` : ''}
  ${lbl('pattern', 'Pattern on top')}<div class="chips">${Object.entries(PATTERNS).map(([k, x]) => chip('data-pat', k, T('pat_' + k, x.name), pt.id === k)).join('')}</div>
  ${pt.id !== 'none' ? `${lbl('pattern_colour', 'Pattern colour')}${swRow('pat', pt.color)}${lbl('pattern_strength', 'Pattern strength')}${range('patO', .05, .7, .01, pt.opacity, v => Math.round(v * 100) + '%')}` : ''}`;
}
function framePanel(L) {
  const f = L.frame;
  return `${lbl('card_frame', 'Card frame')}
  <div class="grid">${Object.entries(FRAMES).map(([k, F]) => `<button class="tile ${f.id === k ? 'on' : ''}" data-frame="${k}"><div class="ico full" style="aspect-ratio:.75"><svg viewBox="0 0 600 800"><rect width="600" height="800" rx="34" fill="#F3E3F7"/>${F.svg('thf' + k, { c: F.c || '#fff', a: F.a || '#FF6FAE' })}</svg></div><span>${esc(T('frame_' + k, F.name))}</span></button>`).join('')}</div>
  ${f.id !== 'none' && f.id !== 'holo' ? `${lbl('frame_colour', 'Frame colour')}${swRow('fc', f.c)}${lbl('detail_colour', 'Detail colour')}${swRow('fa', f.a)}` : ''}
  <div class="tools">${toolBtn('stamp', T('idea_stamp', 'Idea stamp'), TI.stamp, L.stamp ? 'on' : '')}</div>`;
}
function titlePanel(L) {
  const t = L.title;
  return `${lbl('banner', 'Banner')}<div class="chips">${BANNERS.map(([k, n]) => chip('data-banner', k, T('banner_' + k, n), t.banner === k)).join('')}</div>
  ${lbl('first_word', 'First word')}<div class="chips">${ADJ.map(a => chip('data-adj', a, a ? T('adj_' + a, a) : T('none', 'None'), t.adj === a)).join('')}</div>
  ${lbl('second_word', 'Second word')}<div class="chips">${NOUN.map(n => chip('data-noun', n, T('noun_' + n, n), t.noun === n)).join('')}</div>
  ${lbl('font', 'Font')}<div class="chips">${FONTS.map(([k, ff, n]) => chip('data-font', k, T('font_' + k, n), t.font === k, `style="font-family:${ff.replace(/"/g, "'")}" class="fontchip"`)).join('')}</div>
  ${lbl('text_colour', 'Text colour')}${swRow('tcolor', t.color)}
  ${lbl('outline', 'Outline')}${swRow('toutline', t.outline)}
  ${t.banner === 'ribbon' || t.banner === 'pill' ? `${lbl('banner_colour', 'Banner colour')}${swRow('band', t.band)}` : ''}
  ${fine('title_safe', 'Titles are built from a word list, so nobody can type anything mean.')}`;
}
const BRUSHES = [['pen', 'Pen'], ['marker', 'Marker'], ['neon', 'Neon'], ['rainbow', 'Rainbow'], ['glitter', 'Glitter'], ['hearts', 'Hearts'], ['stars', 'Stars']];
function drawPanel() {
  const b = S.brush;
  return `${lbl('brush', 'Brush')}<div class="chips">${BRUSHES.map(([k, n]) => chip('data-brush', k, T('brush_' + k, n), b.type === k)).join('')}</div>
  ${lbl('size', 'Size')}${range('brushS', 3, 34, 1, b.size, v => v + 'px')}
  ${b.type !== 'rainbow' ? `${lbl('colour', 'Colour')}${swRow('brush', b.color)}` : ''}
  <div class="tools">${toolBtn('undoStroke', T('undo_line', 'Undo line'), TI.undo)}${toolBtn('clearDraw', T('clear_all', 'Clear all'), TI.del, 'danger')}</div>
  ${fine('draw_hint', 'Draw right on the card. Tap Move above to drag things again.')}`;
}
function fxPanel(L) {
  return `${lbl('effects', 'Effects', T('effects_many', 'pick as many as you like'))}
  <div class="grid g3">${Object.entries(FX).map(([k, f]) => `<button class="tile ${L.fx.includes(k) ? 'on' : ''}" data-fx="${k}">${tagDot(f.tags)}<div class="ico" style="background:#2B1A55"><svg viewBox="-30 -20 60 40" style="width:70%">${[[-14, -4, 1.2], [10, 6, .9], [16, -8, .6]].map(([x, y, s], i) => `<g transform="translate(${x} ${y}) scale(${s})">${f.shape(i)}</g>`).join('')}</svg></div><span>${esc(T('fx_' + k, f.name))}</span></button>`).join('')}</div>`;
}
function editorHead(thumb, name) { return `<div class="editor-head"><div class="ico">${thumb}</div><b>${esc(name)}</b><button class="done" data-act="done">${esc(T('done', 'Done'))}</button></div>`; }
function commonTools(st, extra = '') {
  return `${lbl('size', 'Size')}${range('stS', .25, 4, .01, st.s, v => Math.round(v * 100) + '%')}
  ${lbl('turn', 'Turn')}${range('stR', -180, 180, 1, Math.round(st.r), v => v + '°')}
  <div class="tools">${toolBtn('flip', T('flip', 'Flip'), TI.flip)}${toolBtn('layer', st.back ? T('in_front', 'In front') : T('behind_pet', 'Behind pet'), st.back ? TI.front : TI.back)}${toolBtn('fwd', T('forward', 'Forward'), TI.up)}${toolBtn('bwd', T('backward', 'Backward'), TI.down)}${toolBtn('copy', T('copy', 'Copy'), TI.copy)}${toolBtn('reset', T('reset', 'Reset'), TI.reset)}${extra}${toolBtn('delete', T('delete', 'Delete'), TI.del, 'danger')}</div>`;
}
function editorPanel(st) {
  const it = ITEM[st.id], f = st.fill;
  const p = { c: f.c1, a: f.c2, d: shade(f.c1, -.38), s: shade(f.c1, -.14), l: shade(f.c1, .45), m: f.c1 };
  return `${editorHead(itemThumb(it, p), itemName(it))}
  ${lbl('style', 'Style')}<div class="chips">${FILLS.map(([k, n]) => chip('data-fill', k, T('fill_' + k, n), f.mode === k)).join('')}</div>
  ${lbl('main_colour', 'Main colour')}${swRow('st1', f.c1)}
  ${f.mode === 'solid' ? lbl('detail_colour', 'Detail colour') : lbl('second_colour', 'Second colour')}${swRow('st2', f.c2)}
  ${commonTools(st)}`;
}
const SHAPES = [['square', 'Square'], ['circle', 'Circle'], ['heart', 'Heart'], ['star', 'Star']];
function photoEditor(st) {
  return `${editorHead(PHOTOS[st.photo] ? `<img src="${PHOTOS[st.photo]}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:8px">` : '', T('picture', 'Picture'))}
  ${lbl('shape', 'Shape')}<div class="chips">${SHAPES.map(([k, n]) => chip('data-shape', k, T('shape_' + k, n), (st.shape || 'square') === k)).join('')}</div>
  ${st.outline !== false ? `${lbl('outline_colour', 'Outline colour')}${swRow('phOutline', st.outlineColor || '#FFFFFF')}` : ''}
  ${commonTools(st, toolBtn('outline', T('outline', 'Outline'), TI.outline, st.outline !== false ? 'on' : ''))}`;
}

// panel events
$('#panel').addEventListener('click', e => {
  const L = S.look, rm = e.target.closest('[data-rmphoto]');
  if (rm) { removePhoto(rm.dataset.rmphoto); e.stopPropagation(); return; }
  const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset, st = S.sel && S.sel.type === 'st' ? findSt(S.sel.k) : null;
  let card = true;
  if (d.pet) { L.pet.id = d.pet; L.stickers.forEach(s => { if (s.slot) resetOffset(L, s); }); }
  else if (d.wcat) { S.wearCat = d.wcat; card = false; }
  else if (d.scat) { S.stickCat = d.scat; card = false; }
  else if (d.add) {
    const it = ITEM[d.add], ex = it.slot && L.stickers.find(s => s.id === it.id);
    if (ex) { select({ type: 'st', k: ex.k }); return; }
    const n = it.slot ? wear(L, it.id) : (() => { const s = makeSticker(L, it.id); L.stickers.push(s); return s; })();
    commit(); drawCard(); select({ type: 'st', k: n.k }); return;
  }
  else if (d.photo) { addPhotoSticker(d.photo); return; }
  else if (d.plook) { const [, h, s, br] = PET_LOOKS[+d.plook]; Object.assign(L.pet, { hue: h, sat: s, bri: br }); }
  else if (d.glow) L.pet.glow = d.glow;
  else if (d.scene) L.scene.id = d.scene;
  else if (d.sstyle) L.scene.style = d.sstyle;
  else if (d.sfloor) L.scene.floor = !L.scene.floor;
  else if (d.pat) L.pattern.id = d.pat;
  else if (d.frame) { L.frame.id = d.frame; const F = FRAMES[d.frame]; if (F.c) { L.frame.c = F.c; L.frame.a = F.a; } }
  else if (d.banner) L.title.banner = d.banner;
  else if (d.adj !== undefined) L.title.adj = d.adj;
  else if (d.noun) L.title.noun = d.noun;
  else if (d.font) L.title.font = d.font;
  else if (d.brush) { S.brush.type = d.brush; card = false; }
  else if (d.fx) L.fx = L.fx.includes(d.fx) ? L.fx.filter(x => x !== d.fx) : [...L.fx, d.fx];
  else if (d.fill && st) { st.fill.mode = d.fill; if (d.fill !== 'solid' && st.fill.c2 === st.fill.c1) st.fill.c2 = '#FFFFFF'; }
  else if (d.shape && st) st.shape = d.shape;
  else if (d.sw) { setColour(d.sw, d.c); return; }
  else if (d.act) { if (!doAct(d.act, st)) return; }
  else return;
  if (card) { commit(); drawCard(); }
  renderPanel();
});
function doAct(act, st) {
  const L = S.look;
  switch (act) {
    case 'done': select(null); return false;
    case 'pickPhoto':
      if (S.photos.length >= MAX_PHOTOS) { toast(T('photos_full', 'You can keep 12 pictures. Delete one to add another.')); return false; }
      post({ type: 'pick_photo' }); return false;
    case 'pflip': L.pet.flip = !L.pet.flip; break;
    case 'pshadow': L.pet.shadow = !L.pet.shadow; break;
    case 'pcentre': L.pet.x = 300; L.pet.y = 430; break;
    case 'preset': Object.assign(L.pet, { x: 300, y: 430, s: 1, flip: false, hue: 0, sat: 100, bri: 100, glow: 'none' }); L.stickers.forEach(s => { if (s.slot) resetOffset(L, s); }); break;
    case 'stamp': L.stamp = !L.stamp; break;
    case 'undoStroke': L.strokes.pop(); break;
    case 'clearDraw': if (!L.strokes.length) return false; L.strokes = []; toast(T('draw_cleared', 'Drawing cleared. Undo brings it back.')); break;
    case 'flip': st.flip = !st.flip; break;
    case 'layer': st.back = !st.back; break;
    case 'outline': st.outline = st.outline === false; break;
    case 'fwd': case 'bwd': { const i = L.stickers.indexOf(st), j = act === 'fwd' ? i + 1 : i - 1; if (j < 0 || j >= L.stickers.length) return false; L.stickers.splice(i, 1); L.stickers.splice(j, 0, st); break; }
    case 'copy': { const c = clone(st); c.k = nextK(L); if (c.slot) { c.ox += 30 / L.pet.s; c.oy += 30 / L.pet.s; } else { c.x += 40; c.y += 40; } L.stickers.push(c); commit(); drawCard(); select({ type: 'st', k: c.k }); return false; }
    case 'reset': st.s = 1; st.r = 0; st.flip = false; st.back = !!ITEM[st.id].back; if (st.slot) resetOffset(L, st); else { st.x = 300; st.y = 400; } break;
    case 'delete': deleteSel(); return false;
  }
  return true;
}
function setColour(key, c) {
  const L = S.look, st = S.sel && S.sel.type === 'st' ? findSt(S.sel.k) : null;
  const set = {
    st1: () => { st.fill.c1 = c; }, st2: () => { st.fill.c2 = c; }, phOutline: () => { st.outlineColor = c; }, glow: () => { L.pet.glowColor = c; }, sc1: () => { L.scene.c1 = c; }, sc2: () => { L.scene.c2 = c; }, pat: () => { L.pattern.color = c; },
    fc: () => { L.frame.c = c; }, fa: () => { L.frame.a = c; }, tcolor: () => { L.title.color = c; }, toutline: () => { L.title.outline = c; }, band: () => { L.title.band = c; }, brush: () => { S.brush.color = c; },
  }[key];
  if (!set) return;
  set();
  if (key !== 'brush') { commit(); drawCard(); }
  renderPanel();
}
$('#panel').addEventListener('change', e => { const i = e.target; if (i.dataset.swc) setColour(i.dataset.swc, i.value.toUpperCase()); if (i.dataset.rg) { commit(); if (['hue', 'sat', 'bri'].includes(i.dataset.rg)) renderPanel(); } });
$('#panel').addEventListener('input', e => {
  const i = e.target, k = i.dataset.rg; if (!k) return;
  const v = +i.value, L = S.look, st = S.sel && S.sel.type === 'st' ? findSt(S.sel.k) : null;
  const out = i.nextElementSibling;
  if (k === 'petS') { L.pet.s = v; patch(); out.textContent = Math.round(v * 100) + '%'; }
  else if (k === 'hue' || k === 'sat' || k === 'bri') { L.pet[k] = v; drawCard(); out.textContent = v + (k === 'hue' ? '°' : '%'); }
  else if (k === 'patO') { L.pattern.opacity = v; drawCard(); out.textContent = Math.round(v * 100) + '%'; }
  else if (k === 'brushS') { S.brush.size = v; out.textContent = v + 'px'; }
  else if (k === 'stS' && st) { st.s = v; patch(); out.textContent = Math.round(v * 100) + '%'; }
  else if (k === 'stR' && st) { st.r = st.slot && L.pet.flip ? -v : v; patch(); out.textContent = v + '°'; }
});

// ---------- pictures (private, kept by the app) ----------
// The app picks the picture already shrunk to 512 px; here it is drawn on a canvas and saved again as
// JPEG at lower quality until it fits 120 KB (refused if it never does), then handed back to the app.
function shrinkPhoto(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, PHOTO_PX / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [.8, .7, .55, .4, .3]) { const out = c.toDataURL('image/jpeg', q); if ((out.length - 23) * .75 <= PHOTO_MAX_BYTES) return resolve(out); }
      reject(new Error('too_big'));
    };
    img.onerror = () => reject(new Error('bad_image'));
    img.src = dataUrl;
  });
}
function addPhotoSticker(id) {
  const L = S.look, st = makeSticker(L, 'photo'); st.photo = id; st.shape = 'square'; st.outline = true; st.x = 300; st.y = 330; st.fill = { mode: 'solid', c1: '#FFFFFF', c2: '#FFFFFF' };
  L.stickers.push(st); commit(); drawCard(); select({ type: 'st', k: st.k });
}
function removePhoto(id) {
  S.photos = S.photos.filter(p => p !== id); delete PHOTOS[id];
  S.look.stickers = S.look.stickers.filter(s => !(s.id === 'photo' && s.photo === id));
  post({ type: 'photo_delete', id }); commit(); drawCard(); renderPanel();
}

// ---------- runway show ----------
let showTimers = [];
function openShow() {
  const L = S.look, sh = $('#show');
  $('#cardwrap').innerHTML = renderCard(L, { by: BY }) + '<div class="shine"></div>';
  $('#showTitle').textContent = titleWords(L.title) || PET_NAME(L.pet.id);
  $('#showSub').textContent = PET_NAME(L.pet.id);
  let hearts = 0; const counter = $('#showHearts');
  const setCount = () => { counter.innerHTML = `<svg width="16" height="16" viewBox="-12 -12 24 24"><path d="${heartD(0, -1, .6)}" fill="#FF4F9A"/></svg>${esc(Tf('hearts_n', '{n} hearts', { n: hearts.toLocaleString(INIT.lang || undefined) }))}`; };
  setCount();
  sh.hidden = false; sh.classList.remove('open');
  requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add('open')));
  const flash = () => { const f = document.createElement('div'); f.className = 'flash'; f.style.left = (5 + Math.random() * 75) + '%'; f.style.top = (8 + Math.random() * 55) + '%'; sh.appendChild(f); setTimeout(() => f.remove(), 600); };
  const heart = () => {
    const h = document.createElement('div'); h.className = 'heart-up';
    const c = pick(Math.random, ['#FF4F9A', '#FF9FC6', '#FFC94A', '#B58CFF', '#6EC6FF']);
    h.style.left = (10 + Math.random() * 75) + '%'; h.style.setProperty('--dx', ((Math.random() - .5) * 120) + 'px');
    h.innerHTML = `<svg width="${22 + Math.random() * 16}" viewBox="-12 -12 24 24"><path d="${heartD(0, -1, .6)}" fill="${c}" stroke="#fff" stroke-width="1"/></svg>`;
    sh.appendChild(h); setTimeout(() => h.remove(), 2500);
    hearts += 1 + Math.floor(Math.random() * 4); setCount();
  };
  for (let i = 0; i < 7; i++) showTimers.push(setTimeout(flash, 900 + i * 260));
  showTimers.push(setInterval(() => { if (Math.random() < .5) flash(); }, 1100));
  showTimers.push(setInterval(heart, 320));
  S.savedInShow = false; reportScreen();
  post({ type: 'event', name: 'runway_show' });
}
// Leaving the show after saving is the "card finished" moment: the app may show its one
// interstitial here (natural break, min. 3 minutes apart, never for Pro).
function closeShow() {
  showTimers.forEach(t => { clearTimeout(t); clearInterval(t); }); showTimers = []; $('#show').hidden = true;
  reportScreen();
  if (S.savedInShow) { S.savedInShow = false; post({ type: 'card_finished' }); }
}
$('#show').addEventListener('pointermove', e => {
  const r = $('#tilt').getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1), y = clamp((e.clientY - r.top) / r.height, 0, 1);
  const w = $('#cardwrap'); w.style.setProperty('--ry', ((x - .5) * 24).toFixed(1) + 'deg'); w.style.setProperty('--rx', ((.5 - y) * 18).toFixed(1) + 'deg');
  w.style.setProperty('--mx', (x * 100).toFixed(0) + '%'); w.style.setProperty('--my', (y * 100).toFixed(0) + '%');
});
$('#show').addEventListener('pointerleave', () => { const w = $('#cardwrap'); w.style.setProperty('--rx', '0deg'); w.style.setProperty('--ry', '0deg'); });
$('#showClose').onclick = closeShow;
$('#enterBtn').onclick = openShow;
$('#saveCard').onclick = () => {
  const card = { look: clone(S.look), t: Date.now() };
  if (S.editing >= 0 && S.cards[S.editing]) S.cards[S.editing] = card;
  else { S.cards.unshift(card); S.cards = S.cards.slice(0, MAX_CARDS); S.editing = 0; }
  S.savedInShow = true;
  saveCards(); toast(T('saved', 'Saved to My cards')); post({ type: 'event', name: 'runway_save' });
};
$('#shareCard').onclick = () => sharePicture();

// ---------- share as a picture ----------
// The card is drawn again as one standalone SVG (pet art as data, the title font inside, effects
// standing still), painted on a canvas with the app's name under it, and handed to the app's share sheet.
const toDataUrl = url => fetch(url, { mode: 'cors' }).then(r => r.blob()).then(b => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(b); }));
let sharing = false;
async function sharePicture() {
  if (sharing) return; sharing = true;
  const busy = document.createElement('div'); busy.className = 'busy'; busy.textContent = T('making_picture', 'Making your picture…'); document.body.appendChild(busy);
  try {
    const L = S.look, petData = await toDataUrl(PET_URL(L.pet.id));
    const font = FONT_DATA[L.title.font] || FONT_DATA.lilita;
    let svg = renderCard(L, { by: BY, petData, still: true }).replace('<svg class="card', '<svg width="1080" height="1440" class="card');
    svg = svg.replace('<defs>', `<defs><style>@font-face{font-family:${JSON.stringify(font.family)};src:url(${font.data}) format("woff2")}@font-face{font-family:"Lilita One";src:url(${FONT_DATA.lilita.data}) format("woff2")}</style>`);
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1720;
    const g = c.getContext('2d'), bg = g.createLinearGradient(0, 0, 0, c.height);
    bg.addColorStop(0, '#FF9FC6'); bg.addColorStop(1, '#8B5CF6'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 60, 60, 1080, 1440);
    g.fillStyle = '#fff'; g.font = '56px "Lilita One", sans-serif'; g.textAlign = 'center'; g.fillText(T('made_with', 'Made with Adopt Me Values'), 600, 1610);
    post({ type: 'share', dataUrl: c.toDataURL('image/png'), title: titleWords(L.title) || PET_NAME(L.pet.id) });
    post({ type: 'event', name: 'runway_share' });
  } catch (_) {
    toast(T('share_failed', 'Could not make the picture. Check your internet and try again.'));
  } finally { busy.remove(); sharing = false; }
}

// ---------- calls from the app (react-native-webview) ----------
window.__rw = {
  // Android Back: close the top layer; on the home screen the app closes Pet Runway.
  back() {
    if (!$('#magic').hidden) return closeMagic();
    if (!$('#show').hidden) return closeShow();
    if (S.sel) return select(null);
    if (screen === 'studio') return go('home');
    post({ type: 'exit' });
  },
  sleep(on) { if (on) { stopMusic(); if (M.ac) M.ac.suspend && M.ac.suspend(); } else if (M.ac) M.ac.resume && M.ac.resume(); },
  setPhotos(list) { (list || []).forEach(p => { if (p && p.id && p.data) { PHOTOS[p.id] = p.data; if (!S.photos.includes(p.id)) S.photos.push(p.id); } }); if (screen === 'studio') { drawCard(); renderPanel(); } else renderHome(); },
  // A picture the player picked (already 512 px from the picker).
  async addPhoto(dataUrl) {
    try {
      const data = await shrinkPhoto(dataUrl), id = 'p' + Date.now().toString(36);
      PHOTOS[id] = data; S.photos.unshift(id);
      post({ type: 'photo_saved', id, data });
      addPhotoSticker(id); S.stickCat = 'photos'; renderPanel();
    } catch (e) { toast(e.message === 'too_big' ? T('photo_too_big', 'That picture is too big. Try another one.') : T('photo_bad', 'That picture could not be opened.')); }
  },
  setEvents(list) {
    EVENTS = (Array.isArray(list) ? list : []).filter(e => e && THEME_BY[e.theme]);
    if (S.editing < 0) stampToday(S.look);
    if (screen === 'studio') { drawCard(); renderPanel(); } else renderHome();
    tick();
  },
  photoError(kind) { toast(kind === 'too_big' ? T('photo_too_big', 'That picture is too big. Try another one.') : T('photo_bad', 'That picture could not be opened.')); },
};

// ---------- start ----------
document.documentElement.lang = INIT.lang || 'en';
if (INIT.rtl) document.documentElement.dir = 'rtl';
$$('[data-t]').forEach(el => { const own = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); if (own) own.textContent = T(el.dataset.t, own.textContent.trim()); });
$$('[data-ta]').forEach(el => el.setAttribute('aria-label', T(el.dataset.ta, el.getAttribute('aria-label'))));
stampToday(S.look);
setInterval(tick, 1000); tick();
commit();
go(INIT.open === 'studio' ? 'studio' : 'home');
post({ type: 'ready' });
