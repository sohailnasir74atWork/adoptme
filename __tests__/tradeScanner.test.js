/**
 * Adopt Me Trade Scanner (Code/TradeScanner): tile finding, badge reading,
 * side split, picks, and the packed WebView page staying in sync.
 */
import scannerHtml from '../Code/TradeScanner/scannerHtml';
import { buildTrade, sideDivider, normalize, PICTURE_SURE } from '../Code/TradeScanner/tradeMatch';

const matcher = require('../Code/TradeScanner/matcher');
const { build } = require('../scripts/trade-scanner/build-html');

// RGBA canvas filled with a grid colour; tiles and badges drawn on it.
function canvas(w, h, bg = [40, 170, 220]) {
  const px = new Uint8Array(w * h * 4);
  for (let p = 0; p < px.length; p += 4) { px[p] = bg[0]; px[p + 1] = bg[1]; px[p + 2] = bg[2]; px[p + 3] = 255; }
  const rect = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = (y * w + x) * 4; px[p] = r; px[p + 1] = g; px[p + 2] = b; }
  };
  const disc = (cx, cy, rad, col) => {
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) rect(x, y, x + 1, y + 1, col);
    }
    rect(cx - 2, cy - 3, cx + 2, cy + 3, [255, 255, 255]); // the letter
  };
  // size-s tile with an "icon" and badges ['M'|'N'|'F'|'R'] from the right.
  const tile = (x, y, s, badges = []) => {
    rect(x, y, x + s, y + s, [244, 254, 244]);
    rect(x + s * 0.25, y + s * 0.2, x + s * 0.7, y + s * 0.6, [150, 80, 40]);
    const colors = { M: [132, 62, 230], N: [150, 205, 60], F: [55, 140, 215], R: [225, 60, 130] };
    const rad = Math.round(s * 0.07);
    let cx = x + s - rad - 4;
    [...badges].reverse().forEach((k) => { disc(cx, y + s - rad - 4, rad, colors[k]); cx -= 2 * rad + 2; });
  };
  return { px, tile };
}

describe('trade scanner page', () => {
  it('scannerHtml.js is the packed scanner.html + matcher.js + signatures (run npm run scanner:build)', () => {
    expect(scannerHtml).toBe(build());
  });

  it('ships signatures for the tradeable catalogue', () => {
    const sigs = require('../Code/TradeScanner/itemSignatures.json');
    expect(sigs.items.length).toBeGreaterThan(1500);
    expect(matcher.loadTemplates(sigs)[0].a.length).toBe(sigs.N * sigs.N);
  });
});

describe('matcher', () => {
  it('finds the white tiles of both grids in reading order', () => {
    const { px, tile } = canvas(700, 300);
    tile(20, 20, 100); tile(130, 20, 100); tile(20, 130, 100);
    tile(450, 20, 100);
    const tiles = matcher.findTiles(px, 700, 300);
    expect(tiles.map((t) => [t.x0, t.y0])).toEqual([[20, 20], [130, 20], [450, 20], [20, 130]]);
  });

  it('reads Mega / Neon and Fly / Ride badges', () => {
    const { px, tile } = canvas(700, 200);
    tile(20, 20, 120, ['M', 'F', 'R']);
    tile(160, 20, 120, ['N', 'R']);
    tile(300, 20, 120, ['F']);
    tile(440, 20, 120);
    const read = matcher.findTiles(px, 700, 200).map((t) => {
      const b = matcher.readBadges(px, 700, t);
      return `${b.variant}${b.fly ? 'F' : ''}${b.ride ? 'R' : ''}`;
    });
    expect(read).toEqual(['mFR', 'nR', 'dF', 'd']);
  });
});

describe('buildTrade', () => {
  const catalog = new Map([['Frost Dragon', 'pets'], ['Turtle', 'pets'], ['Cracked Egg', 'eggs'], ['Kitsune', 'pets']]
    .map(([name, type]) => [normalize(name), { name, type }]));
  const t = (x0, candidates, extra = {}) => ({ x0, x1: x0 + 100, y0: 20, y1: 120, variant: 'd', fly: false, ride: false, candidates, ...extra });

  it('splits on the TRADE label and keeps badges for pets only', () => {
    const tiles = [
      t(20, [{ name: 'Frost Dragon', d: 0.04 }, { name: 'Kitsune', d: 0.3 }], { variant: 'm', fly: true, ride: true }),
      t(560, [{ name: 'Cracked Egg', d: 0.05 }], { variant: 'n', fly: true }),
      t(670, [{ name: 'Turtle', d: 0.2 }]),
    ];
    const trade = buildTrade({ tiles, lines: [{ text: 'TRADE', x: 420, y: 60, w: 100, h: 30 }], width: 1000, catalog });
    expect(trade.mine).toEqual([{ name: 'Frost Dragon', variant: 'm', fly: true, ride: true, sure: true, alternatives: ['Kitsune'] }]);
    expect(trade.theirs.map((p) => [p.name, p.variant, p.fly, p.sure])).toEqual([['Cracked Egg', 'd', false, true], ['Turtle', 'd', false, false]]);
  });

  it('marks a pick unsure when an overlay hid its badges', () => {
    const trade = buildTrade({ tiles: [t(20, [{ name: 'Turtle', d: 0.02 }], { badgesUnsure: true })], width: 500, catalog });
    expect(trade.mine[0].sure).toBe(false);
    expect(PICTURE_SURE).toBeLessThan(0.2);
  });

  it('without the label, splits on the gap between the two grids', () => {
    const tiles = [t(20, []), t(130, []), t(600, [])];
    expect(sideDivider(tiles, [], 2000)).toBeGreaterThan(230);
    expect(sideDivider(tiles, [], 2000)).toBeLessThan(600);
  });
});
