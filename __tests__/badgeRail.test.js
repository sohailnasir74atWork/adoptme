jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../Code/Helper/growthAnalytics', () => ({ trackGrowthEvent: jest.fn() }));
jest.mock('../Code/Helper/deviceFingerprint', () => ({ getDeviceFingerprint: jest.fn(async () => 'dev-test-123') }));
jest.mock('react-native-mmkv', () => {
  const stores = new Map();
  return {
    createMMKV: ({ id } = {}) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const m = stores.get(id);
      return {
        getString: (k) => m.get(k),
        getNumber: (k) => m.get(k),
        getBoolean: (k) => m.get(k),
        set: (k, v) => m.set(k, v),
        remove: (k) => m.delete(k),
      };
    },
  };
});

const { badgeKeysFor, inlineOrder, ORDER } = require('../Code/Helper/badgeRail');
const sq = require('../Code/Helper/squad');
const DAY = 86400000;

describe('badgeKeysFor: one priority order for every surface', () => {
  test('nothing for nobody', () => {
    expect(badgeKeysFor(null)).toEqual([]);
    expect(badgeKeysFor({})).toEqual([]);
  });

  test('authority badges stay mutually exclusive: admin beats mod beats jmd', () => {
    expect(badgeKeysFor({ isAdmin: true, isModerator: true, isBabyMod: true })).toEqual(['admin']);
    expect(badgeKeysFor({ isModerator: true, isBabyMod: true })).toEqual(['mod']);
    expect(badgeKeysFor({ isBabyMod: true })).toEqual(['jmd']);
  });

  test('a player wearing everything lists them in ORDER', () => {
    const all = {
      isAdmin: true, isTrusted: true, isCMSR: true, isArtCMSR: true, isHelper: true,
      squadCount: 50, robloxUsernameVerified: true, isPro: true,
    };
    expect(badgeKeysFor(all)).toEqual(['admin', 'trusted', 'cmsr_house', 'cmsr_art', 'helper', 'squad', 'verified']);
    expect(badgeKeysFor(all)).toEqual(ORDER.filter((k) => !['mod', 'jmd'].includes(k)));
  });

  test('squad shows inline only once it has a rank (3+), on the profile from the first friend', () => {
    expect(badgeKeysFor({ squadCount: 2 })).toEqual([]);
    expect(badgeKeysFor({ squadCount: 3 })).toEqual(['squad']);
    expect(badgeKeysFor({ squadCount: 1 }, { squad: 'any' })).toEqual(['squad']);
    expect(badgeKeysFor({ squadCount: 0 }, { squad: 'any' })).toEqual([]);
  });

  test('`allowed` lets a surface hide badges (group chats never flag Admin/Mod)', () => {
    const u = { isAdmin: true, isBabyMod: true, isTrusted: true };
    expect(badgeKeysFor(u, { allowed: ['jmd', 'trusted', 'cmsr_house', 'cmsr_art', 'helper', 'squad', 'verified'] })).toEqual(['trusted']);
  });

  test('CMSR is two badges with one name: House from isCMSR, Art from isArtCMSR, both wearable', () => {
    expect(badgeKeysFor({ isCMSR: true })).toEqual(['cmsr_house']);
    expect(badgeKeysFor({ isArtCMSR: true })).toEqual(['cmsr_art']);
    expect(badgeKeysFor({ isCMSR: true, isArtCMSR: true })).toEqual(['cmsr_house', 'cmsr_art']);
  });

  test('Pro is not a rail badge (it is never cut)', () => {
    expect(badgeKeysFor({ isPro: true })).toEqual([]);
  });
});

describe('inlineOrder: every badge as an icon, the authority chip last', () => {
  test('icons keep ORDER and the authority chip moves to the end', () => {
    const keys = ['jmd', 'trusted', 'cmsr_house', 'cmsr_art', 'helper', 'squad', 'verified'];
    expect(inlineOrder(keys)).toEqual(['trusted', 'cmsr_house', 'cmsr_art', 'helper', 'squad', 'verified', 'jmd']);
    expect(inlineOrder(['admin', 'verified'])).toEqual(['verified', 'admin']);
  });

  test('nothing is cut: no cap on the inline row', () => {
    const all = badgeKeysFor({
      isModerator: true, isTrusted: true, isCMSR: true, isArtCMSR: true, isHelper: true,
      squadCount: 50, robloxUsernameVerified: true,
    });
    expect(inlineOrder(all)).toHaveLength(all.length);
    expect(inlineOrder(all)[all.length - 1]).toBe('mod');
  });

  test('no authority role, no keys, bad input', () => {
    expect(inlineOrder(['trusted', 'helper'])).toEqual(['trusted', 'helper']);
    expect(inlineOrder([])).toEqual([]);
    expect(inlineOrder(null)).toEqual([]);
  });
});

describe('join window helpers (squad.js)', () => {
  test('canStillJoin: inside 7 days and not yet in a squad', () => {
    const now = Date.now();
    expect(sq.canStillJoin('u1', now - 2 * DAY)).toBe(true);
    expect(sq.canStillJoin('u1', now - 8 * DAY)).toBe(false);
    expect(sq.canStillJoin('u1', null)).toBe(false);
    expect(sq.canStillJoin(null, now)).toBe(false);
  });

  test('takeCodeNudge fires once per account, never with an install-link code pending', () => {
    const now = Date.now();
    expect(sq.takeCodeNudge('u2', now - DAY)).toBe(true);
    expect(sq.takeCodeNudge('u2', now - DAY)).toBe(false); // already nudged
    sq.setPendingCode('ABC234');
    expect(sq.takeCodeNudge('u3', now - DAY)).toBe(false); // the link will join them
    sq.setPendingCode(null);
    expect(sq.takeCodeNudge('u3', now - DAY)).toBe(true);
  });
});
