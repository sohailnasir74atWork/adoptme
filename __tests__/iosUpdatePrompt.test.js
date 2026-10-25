// iOS update popup (Code/AppHelper/iosUpdatePrompt.js).
// Each test loads a fresh copy of the module with its own fake RTDB, MMKV,
// installed version and clock.

function load({ remote, installed = '12.6', store = new Map(), failRead = false } = {}) {
  const calls = { alerts: [], urls: [], reads: 0, appStateListener: null };
  jest.resetModules();
  jest.doMock('react-native', () => ({
    Alert: { alert: (...args) => calls.alerts.push(args) },
    AppState: {
      addEventListener: (_e, fn) => {
        calls.appStateListener = fn;
        return { remove() {} };
      },
    },
    Linking: {
      openURL: jest.fn(async (url) => {
        calls.urls.push(url);
        if (url.startsWith('itms-apps:')) throw new Error('no App Store app');
      }),
    },
  }));
  jest.doMock('react-native-device-info', () => ({ getVersion: () => installed }));
  jest.doMock('../i18n', () => ({ t: (_k, o) => o.defaultValue }));
  jest.doMock('react-native-mmkv', () => ({
    createMMKV: () => ({
      getString: (k) => store.get(k),
      getNumber: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
    }),
  }));
  jest.doMock('@react-native-firebase/app', () => ({ getApp: () => ({}) }));
  jest.doMock('@react-native-firebase/database', () => ({
    getDatabase: () => ({}),
    ref: (_db, path) => path,
    get: async (path) => {
      calls.reads++;
      if (failRead) throw new Error('permission denied');
      expect(path).toBe('ios_version');
      return { val: () => remote };
    },
  }));
  const mod = require('../Code/AppHelper/iosUpdatePrompt');
  return { mod, calls, store };
}

const flush = () => new Promise((r) => setImmediate(r));
const HOUR = 60 * 60 * 1000;

describe('iosUpdatePrompt', () => {
  let now;
  beforeEach(() => {
    now = 1_000_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows the popup when the store version is newer', async () => {
    const { mod, calls } = load({ remote: '12.7' });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(1);
    const [title, , buttons] = calls.alerts[0];
    expect(title).toBe('Update available');
    expect(buttons.map((b) => b.text)).toEqual(['Later', 'Update']);
  });

  it.each([
    ['same version (App Review build = live)', '12.6'],
    ['older version (value not bumped yet)', '12.5'],
    ['stale value', '4.9'],
    ['not a version', 'underreview'],
    ['missing', null],
    ['number with junk', '12.7 beta'],
  ])('shows nothing for %s', async (_name, remote) => {
    const { mod, calls } = load({ remote });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(0);
  });

  it('a build in App Review (newer than the live value) never sees it', async () => {
    const { mod, calls } = load({ remote: '12.6', installed: '12.7' });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(0);
  });

  it('compares numerically, not as text', async () => {
    const { mod, calls } = load({ remote: '12.10', installed: '12.9' });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(1);
  });

  it('accepts a number stored in RTDB', async () => {
    const { mod, calls } = load({ remote: 13 });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(1);
  });

  it('"Update" opens the App Store, falling back to the web link', async () => {
    const { mod, calls } = load({ remote: '12.7' });
    mod.startIosUpdatePrompt();
    await flush();
    await calls.alerts[0][2][1].onPress();
    expect(calls.urls).toEqual([
      'itms-apps://apps.apple.com/app/id6745400111',
      'https://apps.apple.com/app/id6745400111',
    ]);
  });

  it('a failed read shows nothing and does not throw', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { mod, calls } = load({ remote: '12.7', failRead: true });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(0);
  });

  it('re-checks on return to the foreground, at most one read an hour', async () => {
    const { mod, calls } = load({ remote: '12.6' });
    mod.startIosUpdatePrompt();
    mod.startIosUpdatePrompt(); // second call is a no-op
    await flush();
    expect(calls.reads).toBe(1);

    now += 10 * 60 * 1000;
    calls.appStateListener('active');
    await flush();
    expect(calls.reads).toBe(1);

    now += HOUR;
    calls.appStateListener('background');
    await flush();
    expect(calls.reads).toBe(1);
    calls.appStateListener('active');
    await flush();
    expect(calls.reads).toBe(2);
  });

  it('one popup per version per day, across launches', async () => {
    const store = new Map();
    let { mod, calls } = load({ remote: '12.7', store });
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(1);

    now += 2 * HOUR; // next launch, same day
    ({ mod, calls } = load({ remote: '12.7', store }));
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(0);

    now += 2 * HOUR; // a newer release the same day is shown at once
    ({ mod, calls } = load({ remote: '12.8', store }));
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(1);

    now += 25 * HOUR; // still not updated a day later: shown again
    ({ mod, calls } = load({ remote: '12.8', store }));
    mod.startIosUpdatePrompt();
    await flush();
    expect(calls.alerts).toHaveLength(1);
  });
});
