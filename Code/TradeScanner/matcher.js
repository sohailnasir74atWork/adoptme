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
  // colour / shape / hue weights in distance(). A camera shifts colours far
  // more than shapes, so photos lean on shape (measured 2026-11-01: photos
  // 14/21 -> 18/21 right; screenshots stay on SHOT_W, 95.9% top-1).
  var SHOT_W = [1, 0.5, 0.2], PHOTO_W = [0.5, 0.5, 0.05];
  var W = SHOT_W;

  function hsv(r, g, b) {
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return [0, 0, mx];
    var hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [((hh * 60) + 360) % 360, d / mx, mx];
  }
  // The tile: very light and nearly grey (a faint green tint in the game).
  var tileMin = 214, tileSpread = 34;
  var PINK_RG = 8, PINK_BG = -8, pinkWindow = true, yellowTiles = true;
  // Some tiles are a yellow gradient instead (white at the top, orange-yellow
  // at the bottom): red bright, green a little lower, blue lowest.
  function isTile(r, g, b) {
    // The pink inventory window around the tiles is nearly as light: green
    // clearly the lowest channel is pink, never a tile. Screenshots only: a
    // camera tints white tiles pink too.
    if (pinkWindow && r - g > PINK_RG && b - g > PINK_BG) return false;
    if (Math.min(r, g, b) > tileMin && Math.max(r, g, b) - Math.min(r, g, b) < tileSpread) return true;
    return yellowTiles && r > tileMin && g <= r + 4 && g > 0.7 * r && r - b > 0.12 * r;
  }
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

  // The bright green tick the game draws over an accepted offer.
  function isTick(r, g, b) { var c = hsv(r, g, b); return c[0] > 95 && c[0] < 145 && c[1] > 0.5 && c[2] > 150; }

  // Badge colours (hue ranges in degrees, read from game screenshots).
  var BADGES = [
  // N is a light lime green, so it gets a lower saturation floor.
    { key: 'M', h0: 250, h1: 292, s: 0.35 },
    { key: 'N', h0: 66, h1: 140, s: 0.26 },
    { key: 'F', h0: 186, h1: 224, s: 0.35 },
    { key: 'R', h0: 316, h1: 354, s: 0.3 },
  ];
  // loose: photo mode, where the camera washes the badge colours out and
  // shifts them (Fly blue towards cyan, Neon green towards yellow).
  function badgeAt(r, g, b, loose) {
    var c = hsv(r, g, b);
    if (c[2] < 90) return -1;
    for (var i = 0; i < BADGES.length; i++) {
      var h0 = !loose ? BADGES[i].h0 : BADGES[i].key === 'F' ? 172 : BADGES[i].key === 'N' ? 60 : BADGES[i].h0;
      var sMin = loose ? BADGES[i].s * 0.65 : BADGES[i].s;
      if (c[0] >= h0 && c[0] < BADGES[i].h1 && c[1] >= sMin) return i;
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
    if (!loose) {
      // Yellow counts as tile colour, but then the gold "favourite" frame
      // joins its tile into one square too big to keep: a second pass with
      // white tiles only adds what the first one lost.
      var lv = { min: 214, spread: 34 };
      var found = findTilesAt(px, w, h, lv, false);
      yellowTiles = false;
      var white = findTilesAt(px, w, h, lv, false);
      yellowTiles = true;
      white.forEach(function (t) { if (!found.some(function (o) { return overlap(o, t) > 0.3; })) found.push(t); });
      return readingOrder(found);
    }
    var best = [];
    photoTileLevels(px, w, h).forEach(function (lv) {
      var t = findTilesAt(px, w, h, lv, true);
      if (t.length > best.length) best = t;
    });
    return best;
  }

  function findTilesAt(px, w, h, lv, loose) {
    tileMin = lv.min; tileSpread = lv.spread; pinkWindow = !loose;
    var mask = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < w * h; i++, p += 4) if (isTile(px[p], px[p + 1], px[p + 2])) mask[i] = 1;
    var minSide = Math.max(18, Math.round(Math.min(w, h) * (loose ? 0.05 : 0.035)));
    var tiles = [];
    blobs(mask, w, h).forEach(function (b) {
      var bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (bw < minSide || bh < minSide) return;
      if (bw / bh < 0.82 || bw / bh > 1.22) return;
      if (bw > Math.min(w, h) * 0.95) return;
      if (b.n < (loose ? 0.15 : 0.22) * bw * bh) return;
      var t = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
      if (ringWhite(px, w, t) < (loose ? 0.55 : 0.7)) return;
      tiles.push(t);
    });
    // A tight crop can make one tile most of the picture, so size alone does
    // not rule a square out; a square far bigger than the others (a white
    // panel, tiles merged by glare) does.
    if (tiles.length > 2) {
      var sides = tiles.map(function (t) { return t.x1 - t.x0; }).sort(function (m, n) { return m - n; });
      var mid = sides[Math.floor(sides.length / 2)];
      tiles = tiles.filter(function (t) { return t.x1 - t.x0 < 1.5 * mid; });
    }
    // A tile is never inside another one (a white pet part inside a tile is
    // already part of the tile blob, but keep the outer one to be safe).
    tiles = tiles.filter(function (t) {
      return !tiles.some(function (o) { return o !== t && o.x0 <= t.x0 && o.y0 <= t.y0 && o.x1 >= t.x1 && o.y1 >= t.y1; });
    });
    // An overlay (the green "accepted" tick) can split one tile's white into
    // two overlapping blobs: keep the bigger one only.
    function area(t) { return (t.x1 - t.x0) * (t.y1 - t.y0); }
    tiles = tiles.filter(function (t) {
      return !tiles.some(function (o) {
        if (o === t || area(o) < area(t)) return false;
        if (area(o) === area(t) && (o.y0 > t.y0 || (o.y0 === t.y0 && o.x0 >= t.x0))) return false;
        var ix = Math.min(t.x1, o.x1) - Math.max(t.x0, o.x0), iy = Math.min(t.y1, o.y1) - Math.max(t.y0, o.y0);
        return ix > 0 && iy > 0 && ix * iy > 0.25 * area(t);
      });
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
    return readingOrder(tiles);
  }

  // Rows top to bottom, left to right in each row.
  function readingOrder(tiles) {
    tiles = tiles.slice().sort(function (m, n) { return m.y0 - n.y0; });
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
  function readBadges(px, w, t, loose) {
    var side = t.x1 - t.x0;
    var bx0 = t.x0 + Math.round(side * 0.3), bx1 = t.x1;
    // From the bottom edge: a tile cut off at the top of the picture is
    // shorter than wide, its badges still sit on its bottom edge.
    var by0 = Math.max(t.y0, t.y1 - Math.round(side * 0.38)), by1 = t.y1;
    var bw = bx1 - bx0, bh = by1 - by0;
    var cls = new Int8Array(bw * bh).fill(-1);
    for (var y = 0; y < bh; y++) {
      for (var x = 0; x < bw; x++) {
        var p = ((by0 + y) * w + bx0 + x) * 4;
        cls[y * bw + x] = badgeAt(px[p], px[p + 1], px[p + 2], loose);
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
        // A photo blurs a badge into the pixels around it, so it reads bigger.
        var maxB = loose ? 0.34 : 0.24;
        if (hh < side * 0.07 || hh > side * maxB || ww < side * 0.07 || ww > side * maxB) return;
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

  /**
   * Photo-mode badge reader. In a camera photo a badge bleeds into the pet
   * above it, so blobs are unreliable; but the game always draws the badge
   * row in the same place: right-aligned on the tile's bottom edge, one badge
   * every ~0.215 tile widths. Sample a small disc at each slot from the right
   * and classify its colour; stop at the first slot with no badge.
   */
  function readBadgeSlots(px, w, t) {
    var side = t.x1 - t.x0, found = { variant: 'd', fly: false, ride: false, unsure: false, boxes: [] };
    // Sample a ring, not the middle: the letter is white, and some pictures
    // draw the badges as coloured rings with a pale middle.
    var rad = Math.max(3, Math.round(side * 0.08)), hole = Math.round(side * 0.04);
    function sample(cx, cy) {
      var counts = [0, 0, 0, 0], all = 0, best = -1, share = 0;
      for (var dy = -rad; dy <= rad; dy++) {
        for (var dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy > rad * rad || dx * dx + dy * dy < hole * hole) continue;
          var x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= w) continue;
          var p = (y * w + x) * 4;
          var c = badgeAt(px[p], px[p + 1], px[p + 2], true);
          all++;
          if (c >= 0) counts[c]++;
        }
      }
      for (var i = 0; i < 4; i++) if (all && counts[i] / all > share) { share = counts[i] / all; best = i; }
      return { best: best, share: share };
    }
    // The row sits a little higher or lower, further left and wider apart
    // depending on the window and how well the tile box fits (a cell added
    // from the grid is placed by its neighbours): try a few placements and
    // keep the one whose badges read clearest.
    var bestRead = [], bestScore = 0;
    [0, 0.02, 0.04].forEach(function (shift) {
      [0.215, 0.235].forEach(function (pitch) {
        [0.13, 0.16, 0.19].forEach(function (fromBottom) {
          var read = [], score = 0;
          for (var k = 0; k < 3; k++) {
            var r = sample(Math.round(t.x1 - side * (0.135 + shift + pitch * k)), Math.round(t.y1 - side * fromBottom));
            if (r.best < 0 || r.share < 0.4) break;
            read.push(r.best); score += r.share;
          }
          if (score > bestScore) { bestScore = score; bestRead = read; }
        });
      });
    });
    bestRead.forEach(function (best) {
      var key = BADGES[best].key;
      if (key === 'M') found.variant = 'm';
      else if (key === 'N' && found.variant !== 'm') found.variant = 'n';
      else if (key === 'F') found.fly = true;
      else if (key === 'R') found.ride = true;
    });
    return found;
  }

  /** Signature of a tile's icon (badges masked out). */
  function tileSignature(px, w, t, boxes, loose) {
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
    var fgCount = 0, tick = 0, tickEdge = false, rim = 0;
    var bandX = Math.round(cw * 0.1), bandY = Math.round(ch * 0.1);
    for (var yy2 = 0; yy2 < ch; yy2++) {
      for (var xx2 = 0; xx2 < cw; xx2++) {
        if (!fg[yy2 * cw + xx2]) continue;
        fgCount++;
        if (xx2 < bandX || yy2 < bandY || xx2 >= cw - bandX || yy2 >= ch - bandY) rim++;
        var q2 = ((y0 + yy2) * w + x0 + xx2) * 4;
        if (isTick(px[q2], px[q2 + 1], px[q2 + 2])) {
          tick++;
          if (xx2 < 3 || yy2 < 3 || xx2 >= cw - 3 || yy2 >= ch - 3) tickEdge = true;
        }
      }
    }
    // An empty slot (white in some window themes) with a speck on it.
    // (A photo's evened-out lighting leaves faint shading in empty slots.)
    if (fgCount < (loose ? 0.1 : 0.05) * cw * ch) return null;
    // Only the grid frame showing at the rounded corners: an empty slot.
    if (rim > 0.7 * fgCount) return null;
    // An empty slot under the game's green "accepted" tick: nearly all the
    // "icon" is that bright green and it runs off the tile. (A green pet
    // never reaches the tile edge.)
    if (tickEdge && tick > 0.6 * fgCount) return null;
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
    return W[0] * num / (den * 765 + 1e-6) + W[1] * (shape / (N * N)) + W[2] * hue;
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

  // Even out a photo's lighting (a monitor shot is bright in the middle and
  // dark at the edges): divide by the local mean brightness, measured over a
  // fifth of the picture, so a white tile is white wherever it sits.
  function flatField(px, w, h) {
    var r = Math.max(8, Math.round(Math.min(w, h) / 5));
    var sum = new Float64Array((w + 1) * (h + 1));
    for (var y = 0; y < h; y++) {
      var row = 0;
      for (var x = 0; x < w; x++) {
        var p = (y * w + x) * 4;
        row += (px[p] + px[p + 1] + px[p + 2]) / 3;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    var out = new Uint8Array(w * h * 4);
    for (var yy = 0; yy < h; yy++) {
      var ya = Math.max(0, yy - r), yb = Math.min(h, yy + r + 1);
      for (var xx = 0; xx < w; xx++) {
        var xa = Math.max(0, xx - r), xb = Math.min(w, xx + r + 1);
        var mean = (sum[yb * (w + 1) + xb] - sum[ya * (w + 1) + xb] - sum[yb * (w + 1) + xa] + sum[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa));
        var k = 200 / Math.max(20, mean), q = (yy * w + xx) * 4;
        out[q] = Math.min(255, px[q] * k); out[q + 1] = Math.min(255, px[q + 1] * k); out[q + 2] = Math.min(255, px[q + 2] * k); out[q + 3] = 255;
      }
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
  // Best picture distance above this = not an item we know (an empty slot
  // under an overlay, a UI box): the tile is dropped, not guessed.
  var NO_MATCH = 0.6;

  function scanWith(px, w, h, templates, findPx, loose) {
    return scanTiles(px, w, templates, findTiles(findPx, w, h, loose), loose, px);
  }

  // badgePx: the picture the badges are read from. For a photo that is the
  // original: evening out the light clips pale badges to plain white.
  function scanTiles(px, w, templates, tiles, loose, badgePx) {
    return tiles.map(function (t) {
      var badges = loose ? readBadgeSlots(badgePx, w, t) : readBadges(px, w, t, false);
      // A green pet hides a green N badge from the blob reader (one blob too
      // big to be a badge): ask the badge spots too, for Neon / Mega only.
      if (!loose && badges.variant === 'd') {
        var spots = readBadgeSlots(px, w, t);
        if (spots.variant !== 'd') { badges.variant = spots.variant; badges.fly = badges.fly || spots.fly; badges.ride = badges.ride || spots.ride; }
      }
      // A photo's badge boxes are blurred and oversized: masking them would
      // cut into the pet, so photos keep the badge pixels in the picture.
      var sig = tileSignature(px, w, t, loose ? [] : badges.boxes, loose);
      W = loose ? PHOTO_W : SHOT_W;
      return {
        x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1, filled: !!t.filled,
        variant: badges.variant, fly: badges.fly, ride: badges.ride, badgesUnsure: badges.unsure,
        candidates: sig ? rank(sig, templates, 5) : [],
      };
    }).map(function (t) {
      // No picture match (pet wear and stickers are not in the signatures, a
      // pale item has no signature): the square is kept for the tile model
      // with no candidates, so without the model it is still dropped.
      if (!t.candidates.length || t.candidates[0].d >= NO_MATCH) { t.candidates = []; t.weak = true; }
      // Looks like a flat empty slot: the app drops it unless the tile model
      // is fairly sure there is an item (a pale pet on a white tile).
      t.flat = emptySlot(badgePx, w, t);
      return t;
    }).filter(function (t) {
      // An unmatched square that is one flat colour is an empty slot. (Only
      // unmatched ones: a pale pet on a white tile can look flat too.)
      return !t.weak || !t.flat;
    });
  }

  // ── Photo grid (2026-11-02) ──
  // One white level never finds every tile of a photo: a pet filling its tile
  // or the glare across the screen splits the white. Squares found at any
  // level are pooled (photoCandidates), then the trade grid they sit in is
  // rebuilt and its missing cells added (gridCells). Empty slots and the
  // green "+" are dropped by look (emptySlot), not by colour level.
  function overlap(a, b) {
    var ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix <= 0 || iy <= 0) return 0;
    var i = ix * iy;
    return i / ((a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - i);
  }

  // Shared area over the smaller square's area.
  function inside(a, b) {
    var ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix <= 0 || iy <= 0) return 0;
    return ix * iy / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  }

  function photoCandidates(px, soft, w, h) {
    var all = [];
    photoTileLevels(soft, w, h).forEach(function (lv) { all = all.concat(findTilesAt(soft, w, h, lv, true)); });
    // White tiles only: a gold "favourite" frame joins its tile otherwise.
    yellowTiles = false;
    photoTileLevels(soft, w, h).forEach(function (lv) { all = all.concat(findTilesAt(soft, w, h, lv, true)); });
    yellowTiles = true;
    photoTileLevels(px, w, h).forEach(function (lv) { all = all.concat(findTilesAt(px, w, h, lv, true)); });
    // One square per tile: where squares overlap (the white top of a yellow
    // tile, a tile with and without its frame) keep the one closest to the
    // usual tile size.
    if (!all.length) return all;
    var mid = median(all.map(function (t) { return t.x1 - t.x0; }));
    all.sort(function (m, n) { return Math.abs(m.x1 - m.x0 - mid) - Math.abs(n.x1 - n.x0 - mid); });
    var out = [];
    all.forEach(function (t) { if (!out.some(function (o) { return inside(o, t) > 0.5; })) out.push(t); });
    return out;
  }

  function median(v) { v = v.slice().sort(function (m, n) { return m - n; }); return v[Math.floor(v.length / 2)]; }

  // tiles of one size that line up in rows and columns -> every cell of
  // each grid, in reading order. Squares that fit no grid are kept as they
  // are (a 1-item offer).
  // Tiles of one grid are linked to neighbours at most this many steps away
  // (1 = touching, diagonals included); further would bridge the gap between
  // the two offers and fill cells on the TRADE label.
  var LINK = 1.6;
  // The two offers can use different cell sizes (a 3x3 grid beside a 2x2
  // one): each size is rebuilt as its own grid.
  function gridCells(tiles, w, h) {
    var sorted = tiles.slice().sort(function (m, n) { return (m.x1 - m.x0) - (n.x1 - n.x0); });
    var groups = [];
    sorted.forEach(function (t) {
      var g = groups[groups.length - 1];
      if (g && t.x1 - t.x0 <= 1.25 * (g[0].x1 - g[0].x0)) g.push(t);
      else groups.push([t]);
    });
    // A lone square much smaller than the main grid's tiles is part of a
    // slot (glare, a half-lit empty slot), never a slot of its own.
    var main = groups.reduce(function (m, g) { return g.length > m.length ? g : m; }, []);
    var mainSide = main.length ? median(main.map(function (t) { return t.x1 - t.x0; })) : 0;
    groups = groups.filter(function (g) { return g.length > 1 || g === main || g[0].x1 - g[0].x0 >= 0.75 * mainSide; });
    var cells = [].concat.apply([], groups.map(function (g) { return gridOf(g, w, h); }));
    // A cell added from one grid never sits on a found tile or on a cell
    // another grid added first.
    var kept = cells.filter(function (c) { return !c.filled; });
    cells.filter(function (c) { return c.filled; }).forEach(function (c) {
      if (!kept.some(function (o) { return inside(o, c) > 0.3; })) kept.push(c);
    });
    return readingOrder(kept);
  }

  function gridOf(tiles, w, h) {
    if (tiles.length < 2) return tiles;
    var s = median(tiles.map(function (t) { return t.x1 - t.x0; }));
    var same = tiles.filter(function (t) { return Math.abs(t.x1 - t.x0 - s) < 0.2 * s; });
    var steps = [];
    same.forEach(function (a) {
      same.forEach(function (b) {
        var dx = b.x0 - a.x0, dy = b.y0 - a.y0;
        if (Math.abs(dy) < 0.25 * s && dx > 0.95 * s && dx < 1.5 * s) steps.push(dx);
        if (Math.abs(dx) < 0.25 * s && dy > 0.95 * s && dy < 1.5 * s) steps.push(dy);
      });
    });
    if (!steps.length) return tiles;
    var step = median(steps);
    // Grids: tiles chained by neighbours one step apart.
    var group = same.map(function (t, i) { return i; });
    function root(i) { while (group[i] !== i) i = group[i] = group[group[i]]; return i; }
    same.forEach(function (a, i) {
      same.forEach(function (b, j) {
        var dx = Math.abs(b.x0 - a.x0) / step, dy = Math.abs(b.y0 - a.y0) / step;
        var gx = Math.abs(dx - Math.round(dx)), gy = Math.abs(dy - Math.round(dy));
        if (i < j && dx < LINK && dy < LINK && gx < 0.2 && gy < 0.2) group[root(i)] = root(j);
      });
    });
    // Squares of another size are not trade slots once a grid is known.
    var out = [];
    var grids = {};
    same.forEach(function (t, i) { (grids[root(i)] = grids[root(i)] || []).push(t); });
    Object.keys(grids).forEach(function (k) {
      var g = grids[k];
      var ox = Math.min.apply(null, g.map(function (t) { return t.x0; })), oy = Math.min.apply(null, g.map(function (t) { return t.y0; }));
      var col = function (t) { return Math.round((t.x0 - ox) / step); }, row = function (t) { return Math.round((t.y0 - oy) / step); };
      var cols = 1 + Math.max.apply(null, g.map(col)), rows = 1 + Math.max.apply(null, g.map(row));
      if (g.length < 2 || cols * rows > 36) { out = out.concat(g); return; }
      // Each column's left edge / each row's top edge: measured where a tile
      // was found, else stepped from the grid's first one.
      var xs = [], ys = [];
      // Only tiles of the usual size place a column or row: a square cut
      // short (glare, a tick) has its edge in the wrong place.
      var fit = function (t) { return Math.abs(t.x1 - t.x0 - s) < 0.1 * s; };
      for (var c = 0; c < cols; c++) {
        var inCol = g.filter(function (t) { return col(t) === c && fit(t); }).map(function (t) { return t.x0; });
        xs.push(inCol.length ? median(inCol) : ox + c * step);
      }
      for (var r = 0; r < rows; r++) {
        var inRow = g.filter(function (t) { return row(t) === r && fit(t); }).map(function (t) { return t.y0; });
        ys.push(inRow.length ? median(inRow) : oy + r * step);
      }
      for (r = 0; r < rows; r++) {
        for (c = 0; c < cols; c++) {
          var have = g.filter(function (t) { return col(t) === c && row(t) === r; })[0];
          var x0 = Math.round(xs[c]), y0 = Math.round(ys[r]);
          var cell = have || { x0: x0, y0: y0, x1: Math.min(w, x0 + Math.round(s)), y1: Math.min(h, y0 + Math.round(s)), filled: true };
          if (cell.x1 - cell.x0 > 0.8 * s && cell.y1 - cell.y0 > 0.8 * s) out.push(cell);
        }
      }
    });
    out.sort(function (m, n) { return m.y0 - n.y0; });
    var lines = [];
    out.forEach(function (t) {
      var line = lines[lines.length - 1];
      if (line && t.y0 - line[0].y0 < 0.5 * s) line.push(t);
      else lines.push([t]);
    });
    return [].concat.apply([], lines.map(function (line) { return line.sort(function (m, n) { return m.x0 - n.x0; }); }));
  }

  // An empty slot is one flat colour, maybe with a soft glare gradient and
  // the camera's moire stripes; a pet or egg has sharp outlines. Colours are
  // averaged over a small window first (that removes the stripes, whatever
  // their pitch), then counted: share of sampled points in the inner 70% of
  // the cell with a sharp step to the point a few px right or below. The
  // "+" button is mostly bright green.
  var EMPTY_EDGES = 0.05;
  function emptySlot(px, w, t) {
    var side = t.x1 - t.x0, inset = Math.round(side * 0.15), r = Math.max(1, Math.round(side * 0.02));
    var k = Math.max(2, Math.round(side * 0.04)), edges = 0, green = 0, n = 0;
    function mean(x, y) {
      var c = [0, 0, 0], m = 0;
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          var p = ((y + dy) * w + x + dx) * 4;
          c[0] += px[p]; c[1] += px[p + 1]; c[2] += px[p + 2]; m++;
        }
      }
      return [c[0] / m, c[1] / m, c[2] / m];
    }
    function diff(m, o) { return Math.abs(m[0] - o[0]) + Math.abs(m[1] - o[1]) + Math.abs(m[2] - o[2]); }
    for (var y = t.y0 + inset; y < t.y1 - inset - k; y += 3) {
      for (var x = t.x0 + inset; x < t.x1 - inset - k; x += 3) {
        var here = mean(x, y);
        if (Math.max(diff(here, mean(x + k, y)), diff(here, mean(x, y + k))) > 80) edges++;
        var c = hsv(here[0], here[1], here[2]);
        if (c[0] > 80 && c[0] < 150 && c[1] > 0.4 && c[2] > 90) green++;
        n++;
      }
    }
    if (!n || green > 0.35 * n) return true;
    return edges < EMPTY_EDGES * n;
  }

  // How white a tile's own background is: brightness times (1 - 2 x
  // saturation), median over its border band.
  function whiteness(px, w, t) {
    var vals = [], side = t.x1 - t.x0, inset = Math.max(2, Math.round(side * 0.06));
    function take(x, y) {
      var p = (y * w + x) * 4, c = hsv(px[p], px[p + 1], px[p + 2]);
      vals.push(c[2] * Math.max(0, 1 - 2 * c[1]));
    }
    for (var x = t.x0 + inset; x < t.x1 - inset; x += 2) { take(x, t.y0 + inset); take(x, t.y1 - 1 - inset); }
    for (var y = t.y0 + inset; y < t.y1 - inset; y += 2) { take(t.x0 + inset, y); take(t.x1 - 1 - inset, y); }
    vals.sort(function (m, n) { return m - n; });
    return vals.length ? vals[Math.floor(vals.length * 0.6)] : 0;
  }

  /**
   * Full pass. A screenshot is read as is; when the colour-normalised pass
   * finds more tiles (a camera photo of a PC screen) that one is used.
   */
  function scan(px, w, h, templates) {
    var normPx = flatField(normalizeColors(px, w, h), w, h);
    var soft = blur(normPx, w, h, Math.max(1, Math.round(Math.min(w, h) / 350)));
    var plain = scanWith(px, w, h, templates, px, false);
    // Both passes always run: a phone photo of a screen can show a few clean
    // white tiles (the plain pass then sees "a screenshot") while the photo
    // pass, with the grid rebuilt, finds every slot. The one that finds more
    // wins; a tie stays with the plain pass.
    // Evening out the light also turns a grey or tinted empty slot white.
    // Real item tiles are the whitest squares in the original picture, so a
    // square much less white than the whitest one is dropped. A cell added
    // from the grid is placed by its neighbours and can sit a little off its
    // tile (the frame then shows in its border): emptySlot() judged it.
    var levels = normalizeColors(px, w, h);
    var cells = gridCells(photoCandidates(px, soft, w, h), w, h).filter(function (t) { return !emptySlot(px, w, t); });
    var photo = scanTiles(normPx, w, templates, cells, true, px);
    var white = photo.map(function (t) { return whiteness(levels, w, t); });
    var top = Math.max.apply(null, white.concat([0]));
    photo = photo.filter(function (t, i) { return t.filled || white[i] >= 0.6 * top; });
    if (photo.length <= plain.length) return plain;
    return photo.map(function (s) { s.photo = true; return s; });
  }

  var api = {
    N: N, BG: BG, FG_DIFF: FG_DIFF, findTiles: findTiles, gridCells: gridCells, emptySlot: emptySlot, readBadges: readBadges, tileSignature: tileSignature,
    normalizeColors: normalizeColors, flatField: flatField, blur: blur, loadTemplates: loadTemplates, rank: rank, scan: scan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TradeMatcher = api;
})(this);
