/**
 * Trade Scanner: sideways photos (2026-11-10).
 *
 * 5 of 23 Adopt Me reports (2026-11-08 → 11-10, all iPhone camera) were a
 * portrait photo of a landscape screen with the picture really sideways (the
 * file says "upright"). The finder still boxes the tiles, but the tile model
 * reads sideways pets as garbage and the sides split the wrong way.
 *
 * Fix without native code: the hidden scanner WebView turns the picture a
 * quarter turn on a canvas, the app saves it and scans that instead. When to
 * turn is measured, not guessed: the tile model is sure of upright tiles and
 * unsure of sideways ones. On every portrait camera report (scanner-training
 * LOG 2026-11-10): upright pictures 0.47–0.85 mean top score as they are and
 * 0.27–0.44 turned; sideways ones 0.29–0.36 as they are and 0.71–0.75 turned
 * the right way. Rule: only an unsure scan (< 0.55) tries the turns, and a
 * turn wins only at >= 0.6 and >= 0.25 over the original — all 5 sideways
 * reports turn, none of the 18 upright ones does.
 *
 * Plain functions, no React Native: tested in __tests__/tradeScanner.test.js.
 */

// ccw = a quarter turn counter-clockwise (what the sideways reports needed),
// cw = clockwise.
export const TURNS = ['ccw', 'cw'];
export const TRY_BELOW = 0.55;
export const WIN_AT = 0.6;
export const WIN_BY = 0.25;

/** Mean top model score of a scan: 0 with no tiles or no model. */
export function meanTopScore(named) {
  if (!named?.length) return 0;
  const tops = named.map((c) => c?.[0]?.score || 0);
  return tops.reduce((a, b) => a + b, 0) / tops.length;
}

export function shouldTryTurns(base) {
  return base < TRY_BELOW;
}

/** tries: [{ turn, score }]. The turn to use, or null to keep the picture as it is. */
export function pickTurn(base, tries) {
  let best = null;
  (tries || []).forEach((t) => { if (!best || t.score > best.score) best = t; });
  if (!best || best.score < WIN_AT || best.score < base + WIN_BY) return null;
  return best.turn;
}

/**
 * The crop frame (shares of the picture) after the picture turns, so the
 * same area is scanned. ccw: a point (x, y) of a W x H picture goes to
 * (y, W - x); cw: to (H - y, x).
 */
export function turnFrame(f, turn) {
  if (turn === 'ccw') return { x: f.y, y: 1 - f.x - f.w, w: f.h, h: f.w };
  if (turn === 'cw') return { x: 1 - f.y - f.h, y: f.x, w: f.h, h: f.w };
  return f;
}

/**
 * JavaScript for the scanner WebView: defines window.__tradeRotate (any
 * scanner page version; the app injects it) and turns one picture. Posts
 * { type: 'rotated', id, width, height, base64 } (JPEG) or { type: 'error' }.
 */
export function rotateScript(id, dataUrl, turn) {
  return `(function () {
  if (!window.__tradeRotate) {
    window.__tradeRotate = function (id, src, turn) {
      var post = function (m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); };
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight;
          var c = document.createElement('canvas');
          c.width = h; c.height = w;
          var ctx = c.getContext('2d');
          if (turn === 'ccw') { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
          else { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
          ctx.drawImage(img, 0, 0);
          var url = c.toDataURL('image/jpeg', 0.92);
          post({ type: 'rotated', id: id, width: h, height: w, base64: url.slice(url.indexOf(',') + 1) });
        } catch (e) { post({ type: 'error', id: id, message: 'rotate ' + String(e && e.message || e) }); }
      };
      img.onerror = function () { post({ type: 'error', id: id, message: 'rotate decode' }); };
      img.src = src;
    };
  }
  window.__tradeRotate(${JSON.stringify(id)}, ${JSON.stringify(dataUrl)}, ${JSON.stringify(turn)});
})(); true;`;
}
