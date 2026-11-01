// ---------- Magic: brings a finished card to life, layer by layer, with a jingle made in code ----------
// Timeline (seconds): scene fades in and the camera settles (0-1.8), the pet drops in (0.2-1.1) and then
// does the chosen move forever, items pop on one by one (from 1.15), the drawing draws itself (2.0-3.7),
// the title stamps in (2.7), a shine sweeps the frame (3.4, then every 6 s), confetti bursts (5.6).
const MOVES = [['dance', 'Dance'], ['float', 'Float'], ['twirl', 'Twirl'], ['spooky', 'Spooky Shake'], ['strut', 'Runway Strut']];
const BEAT = .5; // 120 bpm
const c01 = v => Math.max(0, Math.min(1, v));
const easeOutCubic = p => 1 - Math.pow(1 - p, 3);
const easeOutBack = p => 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2);
function easeOutBounce(x) { const n = 7.5625, d = 2.75; if (x < 1 / d) return n * x * x; if (x < 2 / d) return n * (x -= 1.5 / d) * x + .75; if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + .9375; return n * (x -= 2.625 / d) * x + .984375; }

// Pet motion per move; u = seconds since the pet landed. Offsets are in card units, pivot at the feet.
const PET_MOVES = {
  dance: u => { const b = u / BEAT, land = Math.max(0, 1 - (b % 1) * 4); return { dx: Math.sin(Math.PI * b / 2) * 22, dy: -Math.abs(Math.sin(Math.PI * b)) * 34, rot: Math.sin(Math.PI * b / 2) * 9, sx: 1 + .07 * land, sy: 1 - .09 * land }; },
  float: u => ({ dx: Math.sin(u * .9) * 18, dy: -28 + Math.sin(u * 1.7) * 18, rot: Math.sin(u * 1.2) * 6, sx: 1, sy: 1 }),
  twirl: u => { const cyc = u % 2, spin = cyc < .8 ? cyc / .8 : 0; return { dx: 0, dy: -Math.sin(spin * Math.PI) * 52, rot: 0, sx: spin ? Math.cos(spin * Math.PI * 2) : 1 + .02 * Math.sin(u * 6), sy: 1 + .05 * Math.sin(spin * Math.PI) }; },
  spooky: u => { const b = u / BEAT, boo = (b % 4) < .6 ? Math.sin((b % 4) / .6 * Math.PI) : 0; return { dx: Math.sin(u * 47) * 3 + Math.sin(u * 31) * 2, dy: -boo * 34, rot: Math.sin(u * 39) * 2.5 - boo * 7, sx: 1 + boo * .2, sy: 1 + boo * .2, op: .74 + .26 * Math.abs(Math.sin(u * 2.2)) }; },
  strut: u => { const dir = Math.cos(u * 1.05) >= 0 ? 1 : -1, step = Math.abs(Math.sin(u * 2 * Math.PI)); return { dx: Math.sin(u * 1.05) * 72, dy: -step * 13, rot: dir * (2 + step * 4), sx: dir, sy: 1 - .04 * (1 - step) }; },
};

const M = { raf: 0, t0: 0, move: 'dance', look: null, P: null, sound: true, ac: null, bus: null, seq: 0, popped: new Set(), stamped: false, confettied: false, conf: [] };
function kindOf(st) {
  const it = ITEM[st.id];
  if (!st.slot) return it.cat === 'words' ? 'word' : 'free';
  return it.cat === 'wings' || st.id === 'cape' ? 'wings' : (it.cat === 'hats' || it.cat === 'hair') ? 'hat' : it.cat === 'hold' ? 'hold' : 'snug';
}
function magicPrepare(hostEl, look) {
  hostEl.innerHTML = renderCard(look, { by: BY });
  const svg = hostEl.querySelector('svg'), q = s => svg.querySelector(s), idp = svg.dataset.idp;
  q('.lay-cam').parentNode.insertAdjacentHTML('beforeend', `<rect class="mg-flash" width="600" height="800" fill="#fff" opacity="0"/><g class="mg-conf"></g>`);
  q('defs').insertAdjacentHTML('beforeend', `<linearGradient id="${idp}sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`);
  q('.lay-badge').insertAdjacentHTML('afterend', `<rect class="mg-sweep" x="-300" y="-200" width="200" height="1200" fill="url(#${idp}sw)" opacity="0" transform="rotate(18 300 400)" style="mix-blend-mode:screen"/>`);
  const draws = [...q('.lay-draw').children].map(el => {
    let len = 0;
    if (el.tagName === 'path' && el.getAttribute('fill') === 'none' && !el.getAttribute('stroke-dasharray')) { try { len = el.getTotalLength(); } catch (_) {} }
    if (len) el.style.strokeDasharray = len;
    return { el, len };
  });
  M.P = {
    svg, cam: q('.lay-cam'), scene: q('.lay-scene'), pet: q('[data-role="pet"]'), title: q('.lay-title'), badge: q('.lay-badge'), fx: q('.lay-fx'),
    flash: q('.mg-flash'), confG: q('.mg-conf'), sweep: q('.mg-sweep'), draws,
    sts: look.stickers.map((st, i) => ({ st, i, el: q(`.st[data-k="${st.k}"]`), base: gTransform(geom(look, st)), kind: kindOf(st) })),
  };
}
function spawnConfetti() {
  const r = mulberry(77), cols = ['#FF4F9A', '#FFC94A', '#6EC6FF', '#5FD3B0', '#B58CFF', '#FFFFFF'];
  M.conf = Array.from({ length: 54 }, (_, i) => ({ x: 300 + (r() - .5) * 80, y: 470, vx: (r() - .5) * 760, vy: -520 - r() * 560, rot: r() * 360, vr: (r() - .5) * 900, c: cols[i % cols.length], heart: i % 7 === 0 }));
  M.P.confG.innerHTML = M.conf.map(p => p.heart ? `<path d="${heartD(0, -1, .7)}" fill="${p.c}" stroke="#fff" stroke-width="1"/>` : `<rect x="-7" y="-3.5" width="14" height="7" rx="2" fill="${p.c}"/>`).join('');
}
function magicFrame(t) {
  const P = M.P, L = M.look, pet = L.pet, f = pet.flip ? -1 : 1, H = PET_PX / 2 * pet.s;
  // camera settles in and breathes; the scene drifts behind the pet
  const z = 1.14 - .14 * easeOutCubic(c01(t / 1.8)) + .012 * Math.sin(t * 1.4);
  P.cam.setAttribute('transform', `translate(300 400) scale(${z.toFixed(4)}) translate(-300 -400)`);
  P.scene.setAttribute('transform', `translate(300 400) scale(1.05) translate(${(-300 + Math.sin(t * .55) * 9).toFixed(2)} ${(-400 + Math.cos(t * .45) * 6).toFixed(2)})`);
  P.scene.style.opacity = c01(t / .45);
  P.fx.style.opacity = c01((t - 1) / .6);
  // the pet drops in, then does the move
  let m = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, op: 1 };
  if (t < 1.1) { const p = c01((t - .2) / .9); m.dy = -560 * (1 - easeOutBounce(p)); m.op = p > 0 ? 1 : 0; }
  else Object.assign(m, PET_MOVES[M.move](t - 1.1));
  const px = pet.x + m.dx, py = pet.y + m.dy;
  P.pet.setAttribute('transform', `translate(${px.toFixed(1)} ${(py + H).toFixed(1)}) rotate(${m.rot.toFixed(2)}) scale(${(f * pet.s * m.sx).toFixed(4)} ${(pet.s * m.sy).toFixed(4)}) translate(0 ${-PET_PX / 2})`);
  P.pet.style.opacity = m.op;
  // worn items ride along with the pet; every item pops in, then wiggles in its own way
  const wrap = `translate(${px.toFixed(1)} ${(py + H).toFixed(1)}) rotate(${m.rot.toFixed(2)}) scale(${m.sx.toFixed(4)} ${m.sy.toFixed(4)}) translate(${(-pet.x).toFixed(1)} ${(-pet.y - H).toFixed(1)})`;
  for (const { st, i, el, base, kind } of P.sts) {
    if (!el) continue;
    const pp = c01((t - 1.15 - i * .13) / .38), pop = pp ? easeOutBack(pp) : .0001;
    let w = '';
    if (kind === 'wings') { const fast = M.move === 'float' ? 9 : 6; w = `scale(${(1 - (M.move === 'float' ? .38 : .26) * Math.abs(Math.sin(t * fast))).toFixed(3)} 1)`; }
    else if (kind === 'hat') w = `rotate(${(Math.sin(t * 4.2 + i) * 5).toFixed(2)})`;
    else if (kind === 'hold') w = `rotate(${(Math.sin(t * 3 + i) * 11).toFixed(2)})`;
    else if (kind === 'free') w = `translate(0 ${(Math.sin(t * 2 + i) * 9).toFixed(1)}) rotate(${(Math.sin(t * 1.4 + i) * 8).toFixed(1)})`;
    else if (kind === 'word') w = `scale(${(1 + .07 * Math.sin(t * 4 + i)).toFixed(3)})`;
    el.setAttribute('transform', `${st.slot ? wrap + ' ' : ''}${base} scale(${pop.toFixed(4)}) ${w}`);
    if (pp > 0 && !M.popped.has(st.k)) { M.popped.add(st.k); blip(880 + (i % 5) * 132); }
  }
  // the drawing draws itself
  const n = P.draws.length, fd = c01((t - 2) / 1.7);
  P.draws.forEach((d, i) => { const k = c01(fd * n - i); if (d.len) d.el.style.strokeDashoffset = (d.len * (1 - k)).toFixed(1); else d.el.style.opacity = k > 0 ? 1 : 0; });
  // title stamps in, badges fade in
  const tp = c01((t - 2.7) / .55), tk = tp ? (1 + 1.3 * (1 - easeOutBack(tp))) * (1 + (t > 3.3 ? .025 * Math.sin(t * 3) : 0)) : .0001;
  P.title.setAttribute('transform', `translate(300 728) scale(${tk.toFixed(4)}) translate(-300 -728)`);
  P.title.style.opacity = c01(tp * 3);
  P.badge.style.opacity = c01((t - 3.2) / .4);
  if (tp > 0 && !M.stamped) { M.stamped = true; thump(); }
  // shine across the frame
  const sp = t > 3.4 ? (t - 3.4) % 6 : 9;
  P.sweep.setAttribute('opacity', sp < 1 ? 1 : 0); if (sp < 1) P.sweep.setAttribute('x', (-300 + sp * 1100).toFixed(0));
  // move extras: dance pulses pink on the beat, spooky has lightning, strut has camera flashes
  let fl = 0, flc = '#FFFFFF';
  if (t > 1.1) {
    const u = t - 1.1;
    if (M.move === 'spooky') { const c = u % 4; fl = (c < .07 || (c > .14 && c < .2)) ? .55 : 0; }
    else if (M.move === 'strut') fl = (u % 1.5) < .07 ? .32 : 0;
    else if (M.move === 'dance') { fl = Math.max(0, 1 - ((u / BEAT) % 1) * 5) * .13; flc = '#FF4F9A'; }
  }
  P.flash.setAttribute('opacity', fl.toFixed(3)); P.flash.setAttribute('fill', flc);
  // confetti finale
  if (t > 5.6 && !M.confettied) { M.confettied = true; spawnConfetti(); fanfare(); }
  if (M.conf.length) {
    const dt = t - 5.6, els = P.confG.children;
    M.conf.forEach((p, i) => { const y = p.y + p.vy * dt + 560 * dt * dt; els[i].setAttribute('transform', `translate(${(p.x + p.vx * dt).toFixed(1)} ${y.toFixed(1)}) rotate(${(p.rot + p.vr * dt).toFixed(0)})`); els[i].style.opacity = y > 860 ? 0 : 1; });
    if (dt > 4) { M.conf = []; P.confG.innerHTML = ''; }
  }
}

// ---------- jingles (WebAudio, nothing to download) ----------
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const SONGS = {
  dance: { bass: [48, 48, 55, 55, 53, 53, 55, 55], lead: [72, 76, 79, 76, 74, 77, 81, 77, 72, 76, 79, 84, 83, 79, 76, 74], wave: 'square', lv: .045 },
  float: { bass: [48, 0, 45, 0, 41, 0, 43, 0], lead: [79, 0, 76, 0, 77, 0, 74, 0, 76, 0, 72, 0, 74, 0, 71, 0], wave: 'sine', lv: .1, long: true },
  twirl: { bass: [48, 52, 55, 52, 53, 57, 60, 57], lead: [72, 76, 79, 84, 88, 84, 79, 76, 74, 77, 81, 86, 89, 86, 81, 77], wave: 'triangle', lv: .09 },
  spooky: { bass: [45, 45, 52, 52, 48, 48, 52, 51], lead: [69, 0, 72, 76, 75, 0, 71, 68, 69, 0, 72, 76, 77, 76, 75, 71], wave: 'square', lv: .04 },
  strut: { bass: [43, 0, 43, 46, 48, 0, 46, 43], lead: [0, 79, 0, 79, 82, 0, 79, 77, 0, 79, 0, 82, 84, 82, 79, 0], wave: 'sawtooth', lv: .03 },
};
function audioCtx() {
  if (!M.ac) { try { M.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return null; } }
  if (M.ac.state === 'suspended') M.ac.resume();
  return M.ac;
}
function tone(freq, at, dur, type, vol, glide) {
  const ac = M.ac; if (!ac || !M.sound || !M.bus) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, at); if (glide) o.frequency.exponentialRampToValueAtTime(glide, at + dur);
  g.gain.setValueAtTime(.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + .015); g.gain.exponentialRampToValueAtTime(.0001, at + dur);
  o.connect(g); g.connect(M.bus); o.start(at); o.stop(at + dur + .05);
}
function startMusic() {
  stopMusic(); const ac = audioCtx(); if (!ac || !M.sound) return;
  M.bus = ac.createGain(); M.bus.gain.value = .6; M.bus.connect(ac.destination);
  let start = ac.currentTime + .05;
  const bar = () => {
    const S = SONGS[M.move];
    S.bass.forEach((b, i) => { if (b) tone(mtof(b), start + i * BEAT, BEAT * .9, 'triangle', .13); });
    S.lead.forEach((nt, i) => { if (nt) tone(mtof(nt), start + i * BEAT / 2, S.long ? BEAT * 1.2 : BEAT * .45, S.wave, S.lv); });
    for (let i = 0; i < 8; i++) tone(6000, start + i * BEAT + BEAT / 2, .03, 'square', .006);
    start += 4; M.seq = setTimeout(bar, Math.max(0, (start - ac.currentTime - .4) * 1000));
  };
  bar();
}
function stopMusic() { clearTimeout(M.seq); if (M.bus) { try { M.bus.disconnect(); } catch (_) {} M.bus = null; } }
const nowT = () => (M.ac ? M.ac.currentTime : 0);
const blip = f => tone(f, nowT(), .22, 'sine', .07);
const thump = () => { tone(140, nowT(), .35, 'sine', .3, 45); tone(1320, nowT() + .02, .3, 'triangle', .05); };
const fanfare = () => [72, 76, 79, 84, 88].forEach((n, i) => tone(mtof(n), nowT() + i * .07, .5, 'triangle', .08));

// ---------- player screen ----------
const MOVE_ICON = {
  dance: '<path d="M9 18 V5 L20 3 V16"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="17.5" cy="16" r="2.5" fill="currentColor"/>',
  float: '<path d="M6 17 a4 4 0 0 1 0 -8 a5 5 0 0 1 9.5 -1.5 A4 4 0 0 1 18 17Z"/>',
  twirl: '<path d="M12 12 m0 -1.5 a1.5 1.5 0 1 1 -1.5 1.5 a3 3 0 0 1 3 -3 a4.5 4.5 0 0 1 4.5 4.5 a6 6 0 0 1 -6 6 a7.5 7.5 0 0 1 -7.5 -7.5"/>',
  spooky: '<path d="M5 20 V10 a7 7 0 0 1 14 0 V20 l-2.3 -2 -2.3 2 -2.4 -2 -2.3 2 -2.4 -2Z"/><circle cx="9.5" cy="10" r="1.2" fill="currentColor"/><circle cx="14.5" cy="10" r="1.2" fill="currentColor"/>',
  strut: `<path d="${sparkD(12, 12, 9)}"/>`,
};
function renderMoves() { $('#moves').innerHTML = MOVES.map(([k, n]) => `<button class="move ${M.move === k ? 'on' : ''}" data-move="${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${MOVE_ICON[k]}</svg>${esc(T('move_' + k, n))}</button>`).join(''); }
function soundIcon() { $('#magicSound').innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9 H8 L13 5 V19 L8 15 H4Z" fill="#fff"/>${M.sound ? '<path d="M16.5 8.5 a5 5 0 0 1 0 7 M19 6 a8.5 8.5 0 0 1 0 12"/>' : '<path d="M17 9 L22 15 M22 9 L17 15"/>'}</svg>`; $('#magicSound').setAttribute('aria-label', M.sound ? T('sound_off', 'Sound off') : T('sound_on', 'Sound on')); }
function restartMagic() {
  cancelAnimationFrame(M.raf);
  magicPrepare($('#magicCard'), M.look);
  M.popped = new Set(); M.stamped = false; M.confettied = false; M.conf = [];
  M.t0 = performance.now();
  const loop = now => { magicFrame((now - M.t0) / 1000); M.raf = requestAnimationFrame(loop); };
  M.raf = requestAnimationFrame(loop);
  if (M.sound) startMusic();
}
function openMagic(look) { M.look = clone(look); $('#magic').hidden = false; renderMoves(); soundIcon(); restartMagic(); reportScreen(); post({ type: 'event', name: 'runway_magic', move: M.move }); }
// No ad around Magic: it is the moment players share (owner + plan 2026-10-31).
function closeMagic() { cancelAnimationFrame(M.raf); stopMusic(); $('#magic').hidden = true; $('#magicCard').innerHTML = ''; reportScreen(); }
$('#moves').addEventListener('click', e => { const b = e.target.closest('[data-move]'); if (!b) return; M.move = b.dataset.move; renderMoves(); if (M.sound) startMusic(); post({ type: 'haptic', kind: 'light' }); });
$('#magicClose').onclick = closeMagic;
$('#magicReplay').onclick = restartMagic;
$('#magicShare').onclick = () => sharePicture();
$('#magicSound').onclick = () => { M.sound = !M.sound; soundIcon(); if (M.sound) startMusic(); else stopMusic(); };
$('#magicBtn').onclick = () => openMagic(S.look);
$('#showMagic').onclick = () => { closeShow(); openMagic(S.look); };
