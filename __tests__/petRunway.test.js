/**
 * Pet Runway (Code/PetRunway): the bundled game, its text keys in every language, and the
 * pure bridge rules (picture limit, saved cards, ads). Run `npm run runway:build` after any
 * edit in Code/PetRunway/game/ or the first test fails.
 */
const fs = require('fs');
const path = require('path');
const { build } = require('../scripts/pet-runway/build-game');
import RUNWAY_HTML from '../Code/PetRunway/runwayGameHtml';
import { RUNWAY_KEYS } from '../Code/PetRunway/runwayKeys';
import { RUNWAY_CATALOG } from '../Code/PetRunway/runwayCatalog';
import {
  MAX_CARDS, MAX_PHOTOS, PHOTO_MAX_BYTES, cleanCards, cleanDraft, cleanPhotos, parseMessage, photoBatches,
  photoFits, showBannerOn, storeKey, withInit,
} from '../Code/PetRunway/runwayBridge';

jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: jest.fn() } }));

const LOCALES = ['en', 'ru', 'es', 'fr', 'de', 'ar', 'ko'];
const tr = (l) => JSON.parse(fs.readFileSync(path.join(__dirname, '../Code/Translation', `${l}.json`), 'utf8'));
const holes = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
const built = build();
const script = built.html.slice(built.html.indexOf('<script>') + 8, built.html.lastIndexOf('</script>'));

describe('Pet Runway bundle', () => {
  it('runwayGameHtml.js, runwayKeys.js and runwayCatalog.js match the game sources (run npm run runway:build)', () => {
    expect(RUNWAY_HTML).toBe(built.html);
    expect(RUNWAY_KEYS).toEqual(built.keys);
    expect(RUNWAY_CATALOG).toEqual(built.catalog);
  });

  it('the server accepts exactly the themes the game has (supabase/061 _runway_theme_keys)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/061_pet_runway_events.sql'), 'utf8');
    const def = sql.indexOf('function public._runway_theme_keys()');
    const block = sql.slice(sql.indexOf('array[', def), sql.indexOf('$$;', def));
    const serverKeys = [...block.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(serverKeys).toEqual(RUNWAY_CATALOG.themes.map((t) => t.id));
    RUNWAY_CATALOG.themes.forEach((t) => expect(t.tags).toHaveLength(2));
    const stamps = sql.match(/not in \('classic'[^)]*\)/)[0].match(/'([a-z]+)'/g).map((x) => x.replace(/'/g, ''));
    expect(stamps).toEqual(RUNWAY_CATALOG.stamps);
  });

  it('the game script parses', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();
  });

  it('only talks to the Pet Cards CDN (pet art); fonts and code are bundled', () => {
    const urls = [...new Set(script.match(/https?:\/\/[a-z0-9.-]+/gi) || [])];
    expect(urls.filter((u) => !['https://cardspull.b-cdn.net', 'http://www.w3.org'].includes(u))).toEqual([]);
    expect(built.html).not.toMatch(/fonts\.googleapis|<link /);
  });

  it('every pet has all anchor points', () => {
    const anchors = JSON.parse(fs.readFileSync(path.join(__dirname, '../Code/PetRunway/game/anchors.json'), 'utf8'));
    const keys = Object.keys(anchors);
    expect(keys.length).toBeGreaterThan(500);
    for (const k of keys) {
      expect(typeof anchors[k].name).toBe('string');
      for (const slot of ['head', 'eyes', 'cheeks', 'neck', 'body', 'hand']) {
        const a = anchors[k][slot];
        expect(a).toHaveLength(3);
        a.forEach((v) => expect(v).toBeGreaterThanOrEqual(-0.2));
        a.forEach((v) => expect(v).toBeLessThanOrEqual(1.5));
      }
    }
  });
});

describe('Pet Runway text', () => {
  it('English in en.json matches the game', () => {
    expect(tr('en').pet_runway).toEqual(built.en);
  });

  it.each(LOCALES)('%s has every key, filled in, with the same placeholders', (l) => {
    const p = tr(l).pet_runway || {};
    for (const k of RUNWAY_KEYS) {
      expect([k, typeof p[k] === 'string' && p[k].trim().length > 0]).toEqual([k, true]);
      expect([k, holes(p[k])]).toEqual([k, holes(built.en[k])]);
    }
    const mg = tr(l).mini_games;
    for (const k of ['runway_name', 'runway_desc', 'runway_short', 'tag_create']) expect(typeof mg[k]).toBe('string');
  });
});

describe('Pet Runway events screen', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../Code/PetRunway/RunwayEventsScreen.jsx'), 'utf8');
  const used = [...screen.matchAll(/\btr\('([a-z_]+)'/g)].map((m) => m[1]);
  const dynamic = [...RUNWAY_CATALOG.stamps.map((k) => `stamp_${k}`), 'status_draft', 'status_approved', 'status_cancelled',
    'err_overlap', 'err_dates', 'err_not_staff', 'err_not_admin', 'err_not_yours', 'err_not_draft', 'err_signin', 'err_not_ready', 'err_generic'];
  const en = tr('en').pet_runway_events;
  it.each(LOCALES)('%s has every Events screen text with the same placeholders', (l) => {
    const p = tr(l).pet_runway_events || {};
    for (const k of [...new Set([...used, ...dynamic])]) {
      expect([k, typeof p[k] === 'string' && p[k].length > 0]).toEqual([k, true]);
      expect([k, (p[k].match(/\{\{\w+\}\}/g) || []).sort().join()]).toEqual([k, (en[k].match(/\{\{\w+\}\}/g) || []).sort().join()]);
    }
  });
  it('maps every server refusal to a message', () => {
    const { errorKey } = require('../Code/PetRunway/runwayApi');
    expect(errorKey({ message: 'overlap' })).toBe('err_overlap');
    expect(errorKey({ message: 'bad_dates' })).toBe('err_dates');
    expect(errorKey({ message: 'not_admin' })).toBe('err_not_admin');
    expect(errorKey({ message: 'sign_in' })).toBe('err_signin');
    expect(errorKey({ code: 'PGRST202', message: 'Could not find the function' })).toBe('err_not_ready');
    expect(errorKey(new Error('boom'))).toBe('err_generic');
  });
  it('counts UTC days', () => {
    const { isoDay, daysBetween } = require('../Code/PetRunway/runwayApi');
    const t = Date.UTC(2026, 11, 31, 23, 30);
    expect(isoDay(0, t)).toBe('2026-12-31');
    expect(isoDay(1, t)).toBe('2027-01-01');
    expect(daysBetween('2026-12-20', '2026-12-31')).toBe(11);
  });
});

describe('Pet Runway bridge', () => {
  const look = { pet: { id: 'arcticfox' }, stickers: [] };
  const jpeg = (bytes) => `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;

  it('keeps saved data per account', () => {
    expect(storeKey('cards', 'u1')).toBe('cards:u1');
    expect(storeKey('photos', null)).toBe('photos:guest');
  });

  it('cleans saved cards and drafts', () => {
    expect(cleanCards(null)).toEqual([]);
    expect(cleanCards([{ look }, { look: {} }, 5])).toEqual([{ look, t: 0 }]);
    expect(cleanCards(Array.from({ length: 40 }, () => ({ look, t: 1 })))).toHaveLength(MAX_CARDS);
    expect(cleanDraft(look)).toBe(look);
    expect(cleanDraft({ stickers: [] })).toBeNull();
    expect(cleanDraft({ ...look, big: 'x'.repeat(300 * 1024) })).toBeNull();
  });

  it('accepts pictures up to 120 KB only', () => {
    expect(photoFits(jpeg(PHOTO_MAX_BYTES))).toBe(true);
    expect(photoFits(jpeg(PHOTO_MAX_BYTES + 3000))).toBe(false);
    expect(photoFits('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(photoFits('https://example.com/a.jpg')).toBe(false);
    const list = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, data: jpeg(1000) }));
    expect(cleanPhotos([...list, { id: 'p1', data: jpeg(1000) }, { id: 'bad id', data: jpeg(10) }])).toHaveLength(MAX_PHOTOS);
  });

  it('shows the banner only on the game home screen, never for Pro', () => {
    expect(['home', 'studio', 'show', 'magic', ''].map((n) => showBannerOn(n, false))).toEqual([true, false, false, false, false]);
    expect(showBannerOn('home', true)).toBe(false);
  });

  it('asks for the interstitial only when a player leaves the show after saving', () => {
    const studio = fs.readFileSync(path.join(__dirname, '../Code/PetRunway/game/studio.js'), 'utf8');
    const magic = fs.readFileSync(path.join(__dirname, '../Code/PetRunway/game/magic.js'), 'utf8');
    expect(studio.match(/type: 'card_finished'/g)).toHaveLength(1);
    expect(studio).toMatch(/if \(S\.savedInShow\) \{ S\.savedInShow = false; post\(\{ type: 'card_finished' \}\)/);
    expect(magic).not.toMatch(/card_finished|magic_closed/);
  });

  it('writes settings ahead of the game script, with no way to close the tag', () => {
    const page = withInit('<html><head></head><body><script>game()</script></body></html>', { nickname: '</script><b>' });
    expect(page.indexOf('__RW_INIT')).toBeLessThan(page.indexOf('game()'));
    expect(page).not.toContain('</script><b>');
    expect(photoBatches([{ id: 'p1', data: '</script>' }])[0]).not.toContain('</script>');
  });

  it('ignores messages that are not the game\'s', () => {
    expect(parseMessage('nope')).toBeNull();
    expect(parseMessage('{"x":1}')).toBeNull();
    expect(parseMessage('{"type":"exit"}')).toEqual({ type: 'exit' });
  });
});
