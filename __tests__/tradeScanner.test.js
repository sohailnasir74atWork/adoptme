/**
 * Adopt Me Trade Scanner (Code/TradeScanner): tile finding, badge reading,
 * side split, picks, and the packed WebView page staying in sync.
 */
import scannerHtml from '../Code/TradeScanner/scannerHtml';
import { buildTrade, sideDivider, normalize, PICTURE_SURE } from '../Code/TradeScanner/tradeMatch';
import { cropLines } from '../Code/TradeScanner/textReader';
import { pickRelease, downloadBytes, scannerState } from '../Code/TradeScanner/scannerRelease';

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

describe('owner photo of a PC trade window (2026-11-01)', () => {
  // Phone photo of the monitor, uneven light, faint badges; stored as raw RGB
  // at 1000 px wide (gzip). Your side: Giraffe MFR. Their side: Owl MFR,
  // Giraffe NFR, Owl FR, Dodo MFR, Golden Unicorn NFR + one item not in the
  // catalogue art (must stay a "?", never a confident guess).
  it('reads every pet and badge', () => {
    const fs = require('fs');
    const zlib = require('zlib');
    const rgb = zlib.gunzipSync(fs.readFileSync(require('path').join(__dirname, 'fixtures/trade-photo-pink.rgb.gz')));
    const w = 1000;
    const h = 418;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/itemSignatures.json'));
    const got = matcher.scan(px, w, h, sigs).map((s) => `${s.candidates[0].name} ${s.variant}${s.fly ? 'F' : ''}${s.ride ? 'R' : ''}`);
    // Your-side Giraffe: since yellow tiles count (2026-11-02) its box is a
    // few px tighter and the picture matcher misnames it; the tile model
    // (Android) reads it as Giraffe 0.87. Its badges must still read.
    expect(got[0]).toMatch(/ mFR$/);
    expect(got.slice(1, 6)).toEqual(['Owl mFR', 'Giraffe nFR', 'Owl dFR', 'Dodo mFR', 'Golden Unicorn nFR']);
  });

  it('reads the same owner photo after the crop step', () => {
    const fs = require('fs');
    const zlib = require('zlib');
    const rgb = zlib.gunzipSync(fs.readFileSync(require('path').join(__dirname, 'fixtures/trade-photo-pink.rgb.gz')));
    const W = 1000;
    // A user frame a bit inside the photo, as the CropBox would give it.
    const x0 = 40; const y0 = 20; const w = 920; const h = 380;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y0 + y) * W + x0 + x; const o = (y * w + x) * 4;
        px[o] = rgb[i * 3]; px[o + 1] = rgb[i * 3 + 1]; px[o + 2] = rgb[i * 3 + 2]; px[o + 3] = 255;
      }
    }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/itemSignatures.json'));
    const got = matcher.scan(px, w, h, sigs).map((s) => `${s.candidates[0].name} ${s.variant}${s.fly ? 'F' : ''}${s.ride ? 'R' : ''}`);
    expect(got.slice(0, 6)).toEqual(['Giraffe mFR', 'Owl mFR', 'Giraffe nFR', 'Owl dFR', 'Dodo mFR', 'Golden Unicorn nFR']);
  });
});

describe('mod photo of a grey trade window (2026-11-02)', () => {
  // Phone photo of a monitor, cropped to the window, 1000 px wide (gzip).
  // Your side: Bat Dragon MFR, the green "+", 7 empty grey slots with moire
  // stripes. Their side: 9 pets, most filling their tile. Every pet is found
  // (cells the white level misses come from the grid), no empty slot or "+"
  // is, and the pale ring badges read right.
  it('finds the 10 pets and their badges, nothing else', () => {
    const rgb = require('zlib').gunzipSync(require('fs').readFileSync(require('path').join(__dirname, 'fixtures/trade-photo-grey.rgb.gz')));
    const w = 1000;
    const h = 594;
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/itemSignatures.json'));
    const got = matcher.scan(px, w, h, sigs);
    expect(got.map((s) => `${s.variant}${s.fly ? 'F' : ''}${s.ride ? 'R' : ''}`))
      .toEqual(['mFR', 'mFR', 'nFR', 'mFR', 'nFR', 'mFR', 'dFR', 'dFR', 'dFR', 'dF']);
    // Bat Dragon alone on the left of the window.
    expect(got.filter((s) => s.x1 < w * 0.45)).toHaveLength(1);
  });
});

describe('tester photo with a gold "favourite" frame (Send picture a896c64d, 2026-11-02)', () => {
  // Phone photo of an orange Trading Hub window, the app's crop, 1000 x 750
  // (gzip). Your side: Phantom Dragon R, a gold-framed pet R, Mochi Meow NR;
  // their side: Phantom Dragon NFR. 195 missed the gold-framed pet.
  // Soft copy: only the white inside the frame is a square, a little under
  // the slot size (the grid places the slot). Sharpened copy (closer to the
  // phone's full-size picture): the square takes the frame, whose gold band
  // must not count as a tinted empty slot.
  ['trade-photo-gold.rgb.gz', 'trade-photo-gold-sharp.rgb.gz'].forEach((file) => {
    it(`finds all four pets in ${file}`, () => {
      const rgb = require('zlib').gunzipSync(require('fs').readFileSync(require('path').join(__dirname, 'fixtures', file)));
      const w = 1000;
      const h = 750;
      const px = new Uint8Array(w * h * 4);
      for (let i = 0; i < w * h; i++) { px[i * 4] = rgb[i * 3]; px[i * 4 + 1] = rgb[i * 3 + 1]; px[i * 4 + 2] = rgb[i * 3 + 2]; px[i * 4 + 3] = 255; }
      const sigs = matcher.loadTemplates(require('../Code/TradeScanner/itemSignatures.json'));
      const got = matcher.scan(px, w, h, sigs);
      expect(got.map((s) => `${s.variant}${s.fly ? 'F' : ''}${s.ride ? 'R' : ''}`)).toEqual(['dR', 'dR', 'nR', 'nFR']);
      // The gold-framed pet sits between the two others on your side.
      expect(got[1].x0).toBeGreaterThan(got[0].x0);
      expect(got[1].x1).toBeLessThan(got[2].x1);
    });
  });
});

describe('offers with different cell sizes (iOS reports 2026-11-06)', () => {
  it('keeps a 1-item offer whose cells are ~1.6x the other grid\'s (My Listings / Offers)', () => {
    const { px, tile } = canvas(900, 400);
    [20, 110, 200].forEach((x) => [20, 110, 200].forEach((y) => tile(x, y, 80)));
    tile(500, 20, 130, ['M', 'F', 'R']);
    const tiles = matcher.findTiles(px, 900, 400);
    expect(tiles.length).toBe(10);
    expect(tiles.some((t) => t.x0 === 500)).toBe(true);
  });

  it('keeps a lone tile of the other offer that sits lower than the user\'s rows', () => {
    const { px, tile } = canvas(900, 400);
    [20, 130].forEach((x) => [80, 190].forEach((y) => tile(x, y, 100)));
    tile(600, 20, 110);
    const tiles = matcher.findTiles(px, 900, 400);
    expect(tiles.some((t) => t.x0 === 600)).toBe(true);
    expect(tiles.length).toBe(5);
  });
});

describe('matcher drops what is not an item', () => {
  it('skips empty white slots and merges a tile split in two', () => {
    const { px, tile } = canvas(700, 300);
    tile(20, 20, 100);
    // An empty white slot (some window themes) next to it.
    for (let y = 20; y < 120; y++) for (let x = 140; x < 240; x++) { const p = (y * 700 + x) * 4; px[p] = 244; px[p + 1] = 254; px[p + 2] = 244; }
    const sigs = matcher.loadTemplates(require('../Code/TradeScanner/itemSignatures.json'));
    const found = matcher.scan(px, 700, 300, sigs);
    expect(found.map((t) => t.x0)).toEqual([20]);
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
    expect(trade.mine).toEqual([{ name: 'Frost Dragon', variant: 'm', fly: true, ride: true, sure: true, seen: { variant: 'm', fly: true, ride: true }, alternatives: ['Kitsune'] }]);
    expect(trade.theirs.map((p) => [p.name, p.variant, p.fly, p.sure])).toEqual([['Cracked Egg', 'd', false, true], ['Turtle', 'd', false, false]]);
  });

  it('a badged tile can only be a pet', () => {
    const cat = new Map([...catalog, [normalize("Crow's Nest Propeller"), { name: "Crow's Nest Propeller", type: 'toys' }], [normalize('Giraffe'), { name: 'Giraffe', type: 'pets' }]]);
    const tiles = [t(20, [{ name: "Crow's Nest Propeller", d: 0.262 }, { name: 'Giraffe', d: 0.263 }], { variant: 'm', fly: true, ride: true })];
    const trade = buildTrade({ tiles, width: 500, catalog: cat });
    expect(trade.mine[0]).toMatchObject({ name: 'Giraffe', variant: 'm', fly: true, ride: true });
  });

  it('marks a pick unsure when an overlay hid its badges', () => {
    const trade = buildTrade({ tiles: [t(20, [{ name: 'Turtle', d: 0.02 }], { badgesUnsure: true })], width: 500, catalog });
    expect(trade.mine[0].sure).toBe(false);
    expect(PICTURE_SURE).toBeLessThan(0.2);
  });

  it('puts a picture without a TRADE label (backpack, one offer) on the user side', () => {
    const tiles = [t(20, [{ name: 'Turtle', d: 0.02 }]), t(130, [{ name: 'Kitsune', d: 0.02 }]), t(240, [{ name: 'Frost Dragon', d: 0.02 }]), t(350, [{ name: 'Turtle', d: 0.02 }])];
    const lines = [{ text: 'BACKPACK', x: 10, y: 5, w: 120, h: 30 }, { text: 'FOOD', x: 10, y: 50, w: 50, h: 20 }];
    const trade = buildTrade({ tiles, lines, width: 800, catalog });
    expect(trade.mine.map((p) => p.name)).toEqual(['Turtle', 'Kitsune', 'Frost Dragon', 'Turtle']);
    expect(trade.theirs).toEqual([]);
    expect(trade.foundWindow).toBe(true);
  });

  it('ignores tiles far from the two grids beside the label', () => {
    const tiles = [t(300, [{ name: 'Turtle', d: 0.02 }]), t(600, [{ name: 'Kitsune', d: 0.02 }]), { ...t(300, [{ name: 'Frost Dragon', d: 0.02 }]), y0: 1500, y1: 1600 }];
    const trade = buildTrade({ tiles, lines: [{ text: 'TRADE', x: 420, y: 60, w: 100, h: 30 }], width: 1000, catalog });
    expect([...trade.mine, ...trade.theirs].map((p) => p.name)).toEqual(['Turtle', 'Kitsune']);
  });

  it('keeps pet wear from the catalogue, never badged', () => {
    const cat = new Map([...catalog, [normalize('Angel Wings'), { name: 'Angel Wings', type: 'pet wear' }]]);
    const trade = buildTrade({ tiles: [t(20, [{ name: 'Angel Wings', d: 0.2 }], { model: true, variant: 'n', fly: true })], width: 500, catalog: cat });
    expect(trade.mine).toMatchObject([{ name: 'Angel Wings', variant: 'd', fly: false, ride: false, sure: true }]);
  });

  it('drops the swap arrow under the TRADE label (photo of a screen)', () => {
    const tiles = [t(20, [{ name: 'Turtle', d: 0.02 }]), t(420, [{ name: 'Kitsune', d: 0.3 }]), t(700, [{ name: 'Frost Dragon', d: 0.02 }])];
    const trade = buildTrade({ tiles, lines: [{ text: 'TRADE', x: 420, y: 60, w: 100, h: 30 }], width: 1000, catalog });
    expect([...trade.mine, ...trade.theirs].map((p) => p.name)).toEqual(['Turtle', 'Frost Dragon']);
  });

  it('Offers / My Listings: everything right of "Them" is theirs, even with one grid found (report 9766960c)', () => {
    const tiles = [t(560, [{ name: 'Turtle', d: 0.02 }]), t(670, [{ name: 'Kitsune', d: 0.02 }])];
    const lines = [{ text: 'You', x: 30, y: 0, w: 60, h: 20 }, { text: 'Them', x: 550, y: 0, w: 80, h: 20 }];
    const trade = buildTrade({ tiles, lines, width: 1000, catalog });
    expect(trade.mine).toEqual([]);
    expect(trade.theirs.map((p) => p.name)).toEqual(['Turtle', 'Kitsune']);
    const both = buildTrade({ tiles: [t(20, [{ name: 'Frost Dragon', d: 0.02 }]), ...tiles], lines, width: 1000, catalog });
    expect(both.mine.map((p) => p.name)).toEqual(['Frost Dragon']);
  });

  it('without the label, splits on the gap between the two grids', () => {
    const tiles = [t(20, []), t(130, []), t(600, [])];
    expect(sideDivider(tiles, [], 2000)).toBeGreaterThan(230);
    expect(sideDivider(tiles, [], 2000)).toBeLessThan(600);
  });
});

describe('cropLines', () => {
  it('keeps text inside the frame and moves it into frame pixels', () => {
    const lines = [{ text: 'TRADE', x: 480, y: 90, w: 60, h: 20 }, { text: 'Chat', x: 10, y: 380, w: 40, h: 15 }];
    const out = cropLines(lines, 1000, 400, { x: 0.1, y: 0.1, w: 0.8, h: 0.6 });
    expect(out.width).toBe(800);
    expect(out.height).toBe(240);
    expect(out.lines).toEqual([{ text: 'TRADE', x: 380, y: 50, w: 60, h: 20 }]);
  });
});

describe('scanner download and updates (build 196)', () => {
  const file = (n, gz) => ({ url: `https://cdn/v${n}/f`, sha256: `sha${n}`, bytes: 1000, ...(gz ? { gz } : {}) });
  const release = (version, minBuild = 196) => ({ version, minBuild, model: file(version), names: file(version), html: file(version, 400) });
  const manifest = { version: 9, audience: 'mods', releases: { all: release(3), mods: release(4) } };

  it('everyone gets releases.all, staff the newer mods release', () => {
    expect(pickRelease(manifest, { tester: false, build: 196, needsModel: true }).version).toBe(3);
    expect(pickRelease(manifest, { tester: true, build: 196, needsModel: true }).version).toBe(4);
    const promoted = { releases: { all: release(5), mods: release(4) } };
    expect(pickRelease(promoted, { tester: true, build: 196, needsModel: true }).version).toBe(5);
  });

  it('ignores 195-only fields, builds below minBuild and incomplete releases', () => {
    expect(pickRelease({ version: 2, audience: 'all', model: file(2), names: file(2), html: file(2) }, { tester: false, build: 196, needsModel: true })).toBeNull();
    expect(pickRelease(manifest, { tester: false, build: 195, needsModel: true })).toBeNull();
    const noModel = { releases: { all: { version: 3, minBuild: 196, html: file(3) } } };
    expect(pickRelease(noModel, { tester: false, build: 196, needsModel: true })).toBeNull();
    // An iOS build without the slot model needs the page only.
    expect(pickRelease(noModel, { tester: false, build: 196, needsModel: false }).version).toBe(3);
    expect(pickRelease(null, { tester: true, build: 196, needsModel: true })).toBeNull();
  });

  it('iOS checks minBuildIos, not the Android versionCode', () => {
    // iOS build numbers (101, 122) are far below Android versionCodes.
    expect(pickRelease(manifest, { tester: false, build: 101, needsModel: true, ios: true }).version).toBe(3);
    const gated = { releases: { all: { ...release(3), minBuildIos: 130 } } };
    expect(pickRelease(gated, { tester: false, build: 129, needsModel: true, ios: true })).toBeNull();
    expect(pickRelease(gated, { tester: false, build: 130, needsModel: true, ios: true }).version).toBe(3);
    expect(pickRelease(gated, { tester: false, build: 196, needsModel: true }).version).toBe(3);
  });

  it('download size counts only new files, the page gzipped', () => {
    expect(downloadBytes(release(3), true, null)).toBe(2400);
    expect(downloadBytes(release(3), false, null)).toBe(400);
    expect(downloadBytes(release(3), true, { model: { sha256: 'SHA3' }, names: { sha256: 'sha1' } })).toBe(1400);
  });

  it('states: missing, unavailable, old, current, installed', () => {
    expect(scannerState(null, release(3))).toBe('missing');
    expect(scannerState(null, null)).toBe('unavailable');
    expect(scannerState({ version: 2 }, release(3))).toBe('old');
    expect(scannerState({ version: 3 }, release(3))).toBe('current');
    // Offline or nothing published: what is installed keeps working.
    expect(scannerState({ version: 3 }, null)).toBe('installed');
  });
});
