/**
 * Adopt Me Trade Scanner: turn the pixel matcher's tiles (+ the text reader's
 * lines, used only to find the window's centre) into "your side" / "their
 * side" picks (2026-11-01).
 *
 * The game prints no item names, so the picture decides the item and the
 * badges decide Normal / Neon / Mega and Fly / Ride. A pick is "sure" only
 * when the picture match is close enough to have been right every time in the
 * benchmark (scripts/trade-scanner: 2,110 items on synthetic trade windows,
 * distance < 0.15 -> 98-100% right) and no overlay hid the badges.
 */

export const PICTURE_SURE = 0.15;
// Photos of a screen use shape-heavy distances (matcher.js PHOTO_W) and are
// noisier: only a very close match counts as sure.
export const PHOTO_SURE = 0.08;
// The trained tile model (tileModel.js): a pick is sure at score >= 0.5
// (d = 1 - score). On 484 hand-checked real tiles every wrong first pick
// scored below 0.45 (RunningApps/_scanner_ml, 2026-11-02).
export const MODEL_SURE = 0.5;

export const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const center = (b) => (b.x0 + b.x1) / 2;

/**
 * x position that separates the two offers: the "TRADE" label between the
 * grids, else the widest gap between tile columns, else the picture's middle.
 */
export function sideDivider(tiles, lines, width) {
  const label = lines.find((l) => /^\s*trade\s*$/i.test(l.text)) || lines.find((l) => /\btrade\b/i.test(l.text));
  if (label) return label.x + label.w / 2;
  const xs = [...new Set(tiles.map((t) => Math.round(center(t))))].sort((a, b) => a - b);
  if (xs.length > 1) {
    const side = tiles.reduce((acc, t) => acc + (t.x1 - t.x0), 0) / tiles.length;
    let best = 0;
    let at = width / 2;
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i] - xs[i - 1];
      if (gap > best) { best = gap; at = (xs[i] + xs[i - 1]) / 2; }
    }
    if (best > side * 1.6) return at;
  }
  return width / 2;
}

/**
 * tiles: from the WebView matcher (image pixels). lines: [{ text, x, y, w, h }]
 * or []. catalog: Map normalized name -> record ({ name, type, ... }).
 * Returns { mine: [pick], theirs: [pick], foundWindow } where
 * pick = { name, variant: 'd'|'n'|'m', fly, ride, sure, seen, alternatives: [name] }.
 */
export function buildTrade({ tiles: allTiles, lines = [], width, catalog }) {
  let tiles = allTiles;
  // The window always says TRADE between the two offers. When the text reader
  // worked and finds no such word, this is not a trade window (the backpack,
  // a value list...): report nothing rather than guess.
  const label = lines.find((l) => /^\s*trade\s*$/i.test(l.text)) || lines.find((l) => /\btrade\b/i.test(l.text));
  if (lines.length && !label) return { mine: [], theirs: [], foundWindow: false };
  if (label && tiles.length) {
    // Only the two grids beside the label count.
    const sides = tiles.map((t) => t.x1 - t.x0).sort((a, b) => a - b);
    const size = sides[Math.floor(sides.length / 2)];
    const lx = label.x + label.w / 2;
    const ly = label.y + label.h / 2;
    tiles = tiles.filter((t) => Math.abs(center(t) - lx) < size * 6.5 && Math.abs((t.y0 + t.y1) / 2 - ly) < size * 4.5);
    // Nothing offered sits under the label: a square there is the swap arrow.
    tiles = tiles.filter((t) => !(t.x0 < lx && t.x1 > lx));
  }
  const divider = sideDivider(tiles, lines, width);
  const mine = [];
  const theirs = [];
  for (const t of tiles) {
    let pictures = (t.candidates || []).filter((c) => catalog.has(normalize(c.name)));
    // Only pets wear N / M / F / R badges: a tile with any badge is a pet.
    const badged = (t.variant && t.variant !== 'd') || t.fly || t.ride;
    if (badged) {
      const pets = pictures.filter((c) => String(catalog.get(normalize(c.name))?.type || '').toLowerCase() === 'pets');
      if (pets.length) pictures = pets;
    }
    if (!pictures.length) continue;
    const best = pictures[0];
    const rec = catalog.get(normalize(best.name));
    // Only pets carry Neon / Mega / Fly / Ride.
    const isPet = String(rec?.type || '').toLowerCase() === 'pets';
    const pick = {
      name: rec?.name || best.name,
      variant: isPet ? t.variant || 'd' : 'd',
      fly: isPet && Boolean(t.fly),
      ride: isPet && Boolean(t.ride),
      sure: best.d < (t.model ? MODEL_SURE : t.photo ? PHOTO_SURE : PICTURE_SURE) && !t.badgesUnsure,
      // What the badges said, kept so a fix to another pet restores them.
      seen: { variant: t.variant || 'd', fly: Boolean(t.fly), ride: Boolean(t.ride) },
      alternatives: pictures.slice(1, 5).map((c) => catalog.get(normalize(c.name))?.name || c.name),
    };
    (center(t) < divider ? mine : theirs).push(pick);
  }
  return { mine, theirs, foundWindow: tiles.length > 0 };
}
