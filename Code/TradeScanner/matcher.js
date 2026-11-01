/**
 * Adopt Me Trade Scanner pixel matcher (2026-11-01).
 *
 * The in-game trade window shows each offered item as its icon on a near-white
 * rounded tile inside a coloured grid (one grid per player, 2x2 / 3x3 / ...).
 * The game prints no item names. Variant and potions are small badges along
 * the tile's bottom-right edge: M (purple square) or N (green circle), then
 * F (blue circle) and R (pink circle).
 *
 * findTiles() finds the white tiles, readBadges() reads the badges, and
 * tileSignature() + rank() match the icon against the bundled signatures
 * (itemSignatures.json, scripts/trade-scanner/build_signatures.py builds them
 * with the same steps). Phone photos of a monitor go through normalizeColors()
 * first. Plain ES5: inlined into the WebView page and required by jest.
 * Nothing leaves the phone.
 */
/* global atob, Buffer */
(function (root) {
  var N = 16;                 // signature edge; set from itemSignatures.json
  var BG = [244, 254, 244];   // tile colour, must match build_signatures.py
  var FG_DIFF = 45;           // |rgb - tile| above this = icon pixel

  function hsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return [0, 0, mx];
    var hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((hh * 60) + 360) % 360, d / mx, mx];
  }
  // The tile: very light and nearly grey (a faint green tint in the game).
  var tileMin = 214, tileSpread = 34;
  function isTile(r, g, b) { return Math.min(r, g, b) > tileMin && Math.max(r, g, b) - Math.min(r, g, b) < tileSpread; }
  // A photo of a monitor never reaches pure white: call "tile" whatever is
  // within reach of the brightest near-grey pixels in the picture.
  function photoTileLevels(px, w, h) {
    var hist = new Uint32Array(256), n = 0;
    for (var p = 0; p < w * h * 4; p += 12) {
      var mn = Math.min(px[p], px[p + 1], px[p + 2]), mx = Math.max(px[p], px[p + 1], px[p + 2]);
      if (mx - mn < 40) { hist[mn]++; n++; }
    }
    var acc = 0, top = 255;
    for (var v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.03) { top = v; break; } }
    // Glare or a white wall can be brighter than the tiles: try a few levels.
    return [30, 50, 70].map(function (d) { return { min: Math.max(150, top - d), spread: 42 }; });
  }

  // Badge colours (hue ranges in degrees, read from game screenshots).
  var BADGES = [
  // N is a light lime green, so it gets a lower saturation floor.
    { key: 'M', h0: 250, h1: 292, s: 0.35 },
    { key: 'N', h0: 66, h1: 140, s: 0.26 },
    { key: 'F', h0: 186, h1: 224, s: 0.35 },
    { key: 'R', h0: 316, h1: 354, s: 0.3 },
  ];
  function badgeAt(r, g, b) {
    var c = hsv(r, g, b);
    if (c[2] < 90) return -1;
    for (var i = 0; i < BADGES.length; i++) {
      if (c[0] >= BADGES[i].h0 && c[0] < BADGES[i].h1 && c[1] >= BADGES[i].s) return i;
    }
    return -1;
  }

  function blobs(mask, w, h) {
    var seen = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var out = [];
    for (var start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      var sp = 0, n = 0;
      var x0 = w, y0 = h, x1 = 0, y1 = 0;
      stack[sp++] = start; seen[start] = 1;
      while (sp) {
        var p = stack[--sp];
        var x = p % w, y = (p - x) / w;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      out.push({ x0: x0, y0: y0, x1: x1 + 1, y1: y1 + 1, n: n });
    }
    return out;
  }

  // Share of the tile's outer ring that is tile-white: a real tile has a clean
  // white border all round, a white UI box with text or a white pet on the
  // map does not look like that.
  function ringWhite(px, w, t) {
    var hit = 0, all = 0, side = t.x1 - t.x0, inset = Math.max(1, Math.round(side * 0.04));
    function at(x, y) { var p = (y * w + x) * 4; all++; if (isTile(px[p], px[p + 1], px[p + 2])) hit++; }
    for (var x = t.x0 + inset; x < t.x1 - inset; x += 2) { at(x, t.y0 + inset); }
    for (var y = t.y0 + inset; y < t.y1 - inset; y += 2) { at(t.x0 + inset, y); at(t.x1 - 1 - inset, y); }
    return all ? hit / all : 0;
  }

  /**
   * px: RGBA bytes, w x h. loose: photo mode (tile white measured from the
   * picture). Returns tiles [{ x0, y0, x1, y1 }] in reading order (rows top
   * to bottom, left to right).
   */
  function findTiles(px, w, h, loose) {
    if (!loose) return findTilesAt(px, w, h, { min: 214, spread: 34 }, false);
    var best = [];
    photoTileLevels(px, w, h).forEach(function (lv) {
      var t = findTilesAt(px, w, h, lv, true);
      if (t.length > best.length) best = t;
    });
    return best;
  }

  function findTilesAt(px, w, h, lv, loose) {
    tileMin = lv.min; tileSpread = lv.spread;
    var mask = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) if (isTile(px[p], px[p + 1], px[p + 2])) mask[i] = 1;
    var minSide = Math.max(18, Math.round(Math.min(w, h) * (loose ? 0.05 : 0.035)));
    var tiles = [];
    blobs(mask, w, h).forEach(function (b) {
      var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (bw < minSide || bh < minSide) return;
      if (bw / bh < 0.82 || bw / bh > 1.22) return;
      if (bw > Math.min(w, h) * 0.6) return;
      if (b.n < (loose ? 0.15 : 0.22) * bw * bh) return;
      var t = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
      if (ringWhite(px, w, t) < (loose ? 0.55 : 0.7)) return;
      tiles.push(t);
    });
    // A tile is never inside another one (a white pet part inside a tile is
    // already part of the tile blob, but keep the outer one to be safe).
    tiles = tiles.filter(function (t) {
      return !tiles.some(function (o) { return o !== t && o.x0 <= t.x0 && o.y0 <= t.y0 && o.x1 >= t.x1 && o.y1 >= t.y1; });
    });
    // Trade tiles sit in grids: keep tiles that share a row or a column with
    // another tile of similar size, or are alone (a 1-item offer).
    if (tiles.length > 1) {
      var maxSide = Math.max.apply(null, tiles.map(function (t) { return t.x1 - t.x0; }));
      tiles = tiles.filter(function (t) {
        var s = t.x1 - t.x0;
        return tiles.some(function (o) {
          if (o === t) return false;
          var so = o.x1 - o.x0;
          if (Math.abs(so - s) > 0.25 * s) return false;
          return Math.abs(o.y0 - t.y0) < 0.2 * s || Math.abs(o.x0 - t.x0) < 0.2 * s;
        }) || (s >= 0.6 * maxSide && tiles.every(function (o) { return o === t || Math.abs((o.x1 - o.x0) - s) > 0.25 * s; }));
      });
    }
    tiles.sort(function (m, n) { return m.y0 - n.y0; });
    var rows = [];
    tiles.forEach(function (t) {
      var row = rows[rows.length - 1];
      if (row && t.y0 - row[0].y0 < 0.5 * (row[0].y1 - row[0].y0)) row.push(t);
      else rows.push([t]);
    });
    return [].concat.apply([], rows.map(function (row) { return row.sort(function (m, n) { return m.x0 - n.x0; }); }));
  }

  /**
   * Badges along the tile's bottom edge. Returns { variant: 'd'|'n'|'m',
   * fly, ride, unsure, boxes: [{x0,y0,x1,y1}] } (boxes in image pixels, masked out of
   * the icon signature).
   */
  function readBadges(px, w, t) {
    var side = t.x1 - t.x0;
    var bx0 = t.x0 + Math.round(side * 0.3), bx1 = t.x1;
    var by0 = t.y0 + Math.round(side * 0.62), by1 = t.y1;
    var bw = bx1 - bx0, bh = by1 - by0;
    var cls = new Int8Array(bw * bh).fill(-1);
    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) {
        var p = ((by0 + y) * w + bx0 + x) * 4;
        cls[y * bw + x] = badgeAt(px[p], px[p + 1], px[p + 2]);
      }
    }
    var found = { variant: 'd', fly: false, ride: false, unsure: false, boxes: [] };
    var cands = [];
    BADGES.forEach(function (bd, k) {
      var mask = new Uint8Array(bw * bh);
      for (var i = 0; i < bw * bh; i++) if (cls[i] === k) mask[i] = 1;
      blobs(mask, bw, bh).forEach(function (b) {
        var ww = b.x1 - b.x0, hh = b.y1 - b.y0;
        // A badge-coloured shape running off the tile (the big green tick the
        // game draws over a confirmed offer) can hide a badge: say so.
        // Badges sit low in the tile, so nothing reaching the band's top is
        // one. A big green shape crossing the band (the tick) may hide one.
        if (b.y0 <= 0) {
          if (bd.key === 'N' && hh > side * 0.2 && ww > side * 0.2) found.unsure = true;
          return;
        }
        // The grid frame showing through the tile's rounded corner: a wedge
        // filled at its bottom-right and empty at its top-left (a round badge
        // is empty at both, the square M badge full at both).
        if (b.x1 >= bw - 1 && b.y1 >= bh - 1 && mask[(b.y1 - 1) * bw + b.x1 - 1] && !mask[b.y0 * bw + b.x0]) return;
        // ~10-20% of the tile, roughly square, ring/disc around a white letter.
        if (hh < side * 0.07 || hh > side * 0.24 || ww < side * 0.07 || ww > side * 0.24) return;
        if (ww / hh < 0.7 || ww / hh > 1.4) return;
        var fill = b.n / (ww * hh);
        if (fill < 0.4 || fill > 0.97) return;
        // White letter in the middle.
        var white = 0, all = 0;
        for (var yy = b.y0 + Math.floor(hh * 0.25); yy < b.y1 - Math.floor(hh * 0.25); yy++) {
          for (var xx = b.x0 + Math.floor(ww * 0.25); xx < b.x1 - Math.floor(ww * 0.25); xx++) {
            var q = ((by0 + yy) * w + bx0 + xx) * 4;
            all++;
            if (Math.min(px[q], px[q + 1], px[q + 2]) > 175) white++;
          }
        }
        if (!all || white / all < 0.03) return;
        cands.push({ key: bd.key, x0: bx0 + b.x0, y0: by0 + b.y0, x1: bx0 + b.x1, y1: by0 + b.y1, cy: by0 + (b.y0 + b.y1) / 2 });
      });
    });
    if (!cands.length) return found;
    // Badges share one baseline and the row ends at the tile's right edge.
    cands.sort(function (m, n) { return n.x1 - m.x1; });
    var anchor = cands[0];
    if (t.x1 - anchor.x1 > side * 0.2) return found;
    var row = cands.filter(function (c) { return Math.abs(c.cy - anchor.cy) < side * 0.06; });
    row.forEach(function (c) {
      if (c.key === 'M') found.variant = 'm';
      else if (c.key === 'N' && found.variant !== 'm') found.variant = 'n';
      else if (c.key === 'F') found.fly = true;
      else if (c.key === 'R') found.ride = true;
      found.boxes.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
    });
    return found;
  }

  /** Signature of a tile's icon (badges masked out). */
  function tileSignature(px, w, t, boxes) {
    var side = t.x1 - t.x0;
    var pad = Math.max(2, Math.round(side * 0.05));
    var x0 = t.x0 + pad, x1 = t.x1 - pad, y0 = t.y0 + pad, y1 = t.y1 - pad;
    var cw = x1 - x0, ch = y1 - y0;
    if (cw < 8 || ch < 8) return null;
    // The tile's own white, measured on its border (photos shift it).
    var rs = [], gs = [], bs = [];
    function take(x, y) { var p = (y * w + x) * 4; rs.push(px[p]); gs.push(px[p + 1]); bs.push(px[p + 2]); }
    for (var x = x0; x < x1; x += 2) { take(x, y0); take(x, y1 - 1); }
    for (var y = y0; y < y1; y += 2) { take(x0, y); take(x1 - 1, y); }
    function med(a) { a.sort(function (m, n) { return m - n; }); return a[Math.floor(a.length / 2)]; }
    var tb = [med(rs), med(gs), med(bs)];
    function inBadge(xx, yy) {
      for (var k = 0; k < boxes.length; k++) {
        var b = boxes[k], m = 2;
        if (xx >= b.x0 - m && xx < b.x1 + m && yy >= b.y0 - m && yy < b.y1 + m) return true;
      }
      return false;
    }
    var fg = new Uint8Array(cw * ch);
    var bx0 = cw, by0 = ch, bx1 = -1, by1 = -1;
    for (var yy = 0; yy < ch; yy++) {
      for (var xx = 0; xx < cw; xx++) {
        if (inBadge(x0 + xx, y0 + yy)) continue;
        var p = ((y0 + yy) * w + x0 + xx) * 4;
        var d = Math.abs(px[p] - tb[0]) + Math.abs(px[p + 1] - tb[1]) + Math.abs(px[p + 2] - tb[2]);
        if (d > FG_DIFF) {
          fg[yy * cw + xx] = 1;
          if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx;
          if (yy < by0) by0 = yy; if (yy > by1) by1 = yy;
        }
      }
    }
    if (bx1 < 0) return null;
    // Re-colour to the reference tile white so photo tint does not count.
    var gain = [BG[0] / Math.max(1, tb[0]), BG[1] / Math.max(1, tb[1]), BG[2] / Math.max(1, tb[2])];
    return boxSignature(function (gx, gy) {
      var q = ((y0 + gy) * w + x0 + gx) * 4;
      return [Math.min(255, px[q] * gain[0]), Math.min(255, px[q + 1] * gain[1]), Math.min(255, px[q + 2] * gain[2]), fg[gy * cw + gx]];
    }, bx0, by0, bx1 + 1, by1 + 1);
  }

  // Box-filter a content box (padded to a square) down to N x N. get(x, y)
  // returns [r, g, b, alpha 0..1]. Same method as build_signatures.py.
  function boxSignature(get, bx0, by0, bx1, by1) {
    var bw = bx1 - bx0, bh = by1 - by0, s = Math.max(bw, bh);
    var ox = bx0 - (s - bw) / 2, oy = by0 - (s - bh) / 2;
    var rgb = new Float32Array(N * N * 3), a = new Float32Array(N * N);
    for (var j = 0; j < N; j++) {
      for (var i = 0; i < N; i++) {
        var sx0 = Math.floor(ox + (i * s) / N), sx1 = Math.max(sx0 + 1, Math.floor(ox + ((i + 1) * s) / N));
        var sy0 = Math.floor(oy + (j * s) / N), sy1 = Math.max(sy0 + 1, Math.floor(oy + ((j + 1) * s) / N));
        var r = 0, g = 0, b = 0, al = 0, cnt = 0;
        for (var y = sy0; y < sy1; y++) {
          for (var x = sx0; x < sx1; x++) {
            var v = (x >= bx0 && x < bx1 && y >= by0 && y < by1) ? get(x, y) : null;
            var k = v ? v[3] : 0;
            r += v ? v[0] * k + BG[0] * (1 - k) : BG[0];
            g += v ? v[1] * k + BG[1] * (1 - k) : BG[1];
            b += v ? v[2] * k + BG[2] * (1 - k) : BG[2];
            al += k; cnt++;
          }
        }
        var o = j * N + i;
        rgb[o * 3] = r / cnt; rgb[o * 3 + 1] = g / cnt; rgb[o * 3 + 2] = b / cnt; a[o] = al / cnt;
      }
    }
    return { rgb: rgb, a: a, hue: hueHist(rgb, a) };
  }

  function hueHist(rgb, a) {
    var hs = new Float32Array(12), total = 0;
    for (var o = 0; o < N * N; o++) {
      if (a[o] < 0.5) continue;
      var c = hsv(rgb[o * 3], rgb[o * 3 + 1], rgb[o * 3 + 2]);
      if (c[1] < 0.25 || c[2] < 50) continue;
      hs[Math.floor(c[0] / 30) % 12] += c[1]; total += c[1];
    }
    for (var k = 0; k < 12; k++) hs[k] = total ? hs[k] / total : 0;
    return hs;
  }

  function distance(q, t) {
    var num = 0, den = 0, shape = 0, hue = 0;
    for (var o = 0; o < N * N; o++) {
      var m = Math.max(q.a[o], t.a[o]);
      num += m * (Math.abs(q.rgb[o * 3] - t.rgb[o * 3]) + Math.abs(q.rgb[o * 3 + 1] - t.rgb[o * 3 + 1]) + Math.abs(q.rgb[o * 3 + 2] - t.rgb[o * 3 + 2]));
      den += m;
      shape += Math.abs(q.a[o] - t.a[o]);
    }
    for (var k = 0; k < 12; k++) hue += Math.abs(q.hue[k] - t.hue[k]);
    return num / (den * 765 + 1e-6) + 0.5 * (shape / (N * N)) + 0.2 * hue;
  }

  // Per-channel levels stretch (1st..99th percentile -> 0..255) for photos.
  function normalizeColors(px, w, h) {
    var hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], n = 0;
    for (var p = 0; p < w * h * 4; p += 16) { hist[0][px[p]]++; hist[1][px[p + 1]]++; hist[2][px[p + 2]]++; n++; }
    var lut = [0, 1, 2].map(function (c) {
      var acc = 0, lo = 0, hi = 255;
      for (var v = 0; v < 256; v++) { acc += hist[c][v]; if (acc <= n * 0.01) lo = v; if (acc < n * 0.99) hi = v + 1; }
      if (hi - lo < 32) { lo = 0; hi = 255; }
      var t = new Uint8Array(256);
      for (var k = 0; k < 256; k++) t[k] = Math.max(0, Math.min(255, Math.round(((k - lo) * 255) / (hi - lo))));
      return t;
    });
    var out = new Uint8Array(w * h * 4);
    for (var q = 0; q < w * h * 4; q += 4) {
      out[q] = lut[0][px[q]]; out[q + 1] = lut[1][px[q + 1]]; out[q + 2] = lut[2][px[q + 2]]; out[q + 3] = 255;
    }
    return out;
  }

  // Separable box blur; takes the moire stripes out of a photo of a screen.
  function blur(px, w, h, r) {
    var tmp = new Uint8Array(w * h * 4), out = new Uint8Array(w * h * 4), n = 2 * r + 1;
    for (var y = 0; y < h; y++) {
      for (var c = 0; c < 3; c++) {
        var acc = 0;
        for (var k = -r; k <= r; k++) acc += px[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c];
        for (var x = 0; x < w; x++) {
          tmp[(y * w + x) * 4 + c] = acc / n;
          acc += px[(y * w + Math.min(w - 1, x + r + 1)) * 4 + c] - px[(y * w + Math.max(0, x - r)) * 4 + c];
        }
      }
    }
    for (var xx = 0; xx < w; xx++) {
      for (var cc = 0; cc < 3; cc++) {
        var a2 = 0;
        for (var kk = -r; kk <= r; kk++) a2 += tmp[(Math.min(h - 1, Math.max(0, kk)) * w + xx) * 4 + cc];
        for (var yy = 0; yy < h; yy++) {
          out[(yy * w + xx) * 4 + cc] = a2 / n;
          a2 += tmp[(Math.min(h - 1, yy + r + 1) * w + xx) * 4 + cc] - tmp[(Math.max(0, yy - r) * w + xx) * 4 + cc];
        }
      }
    }
    for (var q = 3; q < w * h * 4; q += 4) out[q] = 255;
    return out;
  }

  function decodeBase64(b64) {
    if (typeof atob === 'function') {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  /** itemSignatures.json -> [{ id, name, type, rgb, a, hue }] */
  function loadTemplates(json) {
    N = json.N;
    return json.items.map(function (it) {
      var raw = decodeBase64(it.sig);
      var rgb = new Float32Array(N * N * 3), a = new Float32Array(N * N);
      for (var o = 0; o < N * N; o++) {
        rgb[o * 3] = raw[o * 4]; rgb[o * 3 + 1] = raw[o * 4 + 1]; rgb[o * 3 + 2] = raw[o * 4 + 2]; a[o] = raw[o * 4 + 3] / 255;
      }
      return { id: it.id, name: it.name, type: it.type, rgb: rgb, a: a, hue: hueHist(rgb, a) };
    });
  }

  function rank(sig, templates, top) {
    return templates
      .map(function (t) { return { id: t.id, name: t.name, d: Math.round(distance(sig, t) * 1000) / 1000 }; })
      .sort(function (m, n) { return m.d - n.d; })
      .slice(0, top || 5);
  }

  // findPx: where tiles are looked for (blurred for photos); px: what badges
  // and icons are read from.
  function scanWith(px, w, h, templates, findPx, loose) {
    var tiles = findTiles(findPx, w, h, loose);
    return tiles.map(function (t) {
      var badges = readBadges(px, w, t);
      var sig = tileSignature(px, w, t, badges.boxes);
      return {
        x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1,
        variant: badges.variant, fly: badges.fly, ride: badges.ride, badgesUnsure: badges.unsure,
        candidates: sig ? rank(sig, templates, 5) : [],
      };
    });
  }

  /**
   * Full pass. A screenshot is read as is; when the colour-normalised pass
   * finds more tiles (a camera photo of a PC screen) that one is used.
   */
  function scan(px, w, h, templates) {
    var plain = scanWith(px, w, h, templates, px, false);
    var normPx = normalizeColors(px, w, h);
    var soft = blur(normPx, w, h, Math.max(1, Math.round(Math.min(w, h) / 350)));
    if (findTiles(soft, w, h, true).length <= plain.length) return plain;
    return scanWith(normPx, w, h, templates, soft, true).map(function (s) { s.photo = true; return s; });
  }

  var api = {
    N: N, BG: BG, FG_DIFF: FG_DIFF, findTiles: findTiles, readBadges: readBadges, tileSignature: tileSignature,
    normalizeColors: normalizeColors, blur: blur, loadTemplates: loadTemplates, rank: rank, scan: scan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeMatcher = api;
})(this);
