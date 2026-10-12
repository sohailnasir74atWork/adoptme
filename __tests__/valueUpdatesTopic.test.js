/**
 * The "Value Update Notifications" setting (Helper/valueUpdatesTopic.js):
 * keeps this device's membership of the FCM topic 'value-updates' in line
 * with the switch, without a network call on every launch.
 */
const mockStore = new Map();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (k) => mockStore.get(k),
    getBoolean: (k) => mockStore.get(k),
    set: (k, v) => mockStore.set(k, v),
    remove: (k) => mockStore.delete(k),
  }),
}));

const mockMessaging = {
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  getAPNSToken: jest.fn(),
  subscribeToTopic: jest.fn(),
  unsubscribeFromTopic: jest.fn(),
};
jest.mock('@react-native-firebase/messaging', () => mockMessaging);

const mockNotifee = {
  getNotificationSettings: jest.fn(),
  requestPermission: jest.fn(),
};
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 },
}));

const DAY = 86400000;
let topic;
let gate;
let adVisibility;

beforeEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  mockStore.clear();
  mockMessaging.getToken.mockReset().mockResolvedValue('tok-1');
  mockMessaging.getAPNSToken.mockReset().mockResolvedValue('apns-1');
  mockMessaging.subscribeToTopic.mockReset().mockResolvedValue(undefined);
  mockMessaging.unsubscribeFromTopic.mockReset().mockResolvedValue(undefined);
  mockNotifee.getNotificationSettings.mockReset().mockResolvedValue({ authorizationStatus: -1 });
  mockNotifee.requestPermission.mockReset().mockResolvedValue({ authorizationStatus: 1 });
  topic = require('../Code/Helper/valueUpdatesTopic');
  gate = require('../Code/Ads/adsGate');
  adVisibility = require('../Code/Ads/adVisibility');
});

test('on by default: the first launch subscribes, the next one skips', async () => {
  expect(topic.isValueUpdatesEnabled()).toBe(true);
  await expect(topic.syncValueUpdatesTopic()).resolves.toBe(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(1);
  expect(mockMessaging.subscribeToTopic.mock.calls[0][1]).toBe('value-updates');

  await expect(topic.syncValueUpdatesTopic()).resolves.toBe(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(1);
  expect(mockMessaging.unsubscribeFromTopic).not.toHaveBeenCalled();
});

test('the stored switch decides; off unsubscribes once', async () => {
  mockStore.set(topic.VALUE_UPDATES_SETTING_KEY, false);
  expect(topic.isValueUpdatesEnabled()).toBe(false);
  await topic.syncValueUpdatesTopic();
  await topic.syncValueUpdatesTopic();
  expect(mockMessaging.unsubscribeFromTopic).toHaveBeenCalledTimes(1);
  expect(mockMessaging.unsubscribeFromTopic.mock.calls[0][1]).toBe('value-updates');
  expect(mockMessaging.subscribeToTopic).not.toHaveBeenCalled();
});

test('a new FCM token, or a week passing, subscribes again', async () => {
  const now = 1_800_000_000_000;
  jest.spyOn(Date, 'now').mockReturnValue(now);
  await topic.syncValueUpdatesTopic(true);
  mockMessaging.getToken.mockResolvedValue('tok-2');
  await topic.syncValueUpdatesTopic(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(2);

  Date.now.mockReturnValue(now + 6 * DAY);
  await topic.syncValueUpdatesTopic(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(2);
  Date.now.mockReturnValue(now + 8 * DAY);
  await topic.syncValueUpdatesTopic(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(3);
});

test('flipping the switch always calls, in order', async () => {
  await topic.syncValueUpdatesTopic(true);
  const off = topic.syncValueUpdatesTopic(false, { force: true });
  const on = topic.syncValueUpdatesTopic(true, { force: true });
  await expect(Promise.all([off, on])).resolves.toEqual([true, true]);
  expect(mockMessaging.unsubscribeFromTopic).toHaveBeenCalledTimes(1);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(2);
  expect(mockMessaging.unsubscribeFromTopic.mock.invocationCallOrder[0])
    .toBeLessThan(mockMessaging.subscribeToTopic.mock.invocationCallOrder[1]);

  // Same state again without force: already in sync, no call.
  await topic.syncValueUpdatesTopic(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(2);
});

test('a failed call never throws and is retried next time', async () => {
  mockMessaging.subscribeToTopic.mockRejectedValueOnce(new Error('offline'));
  await expect(topic.syncValueUpdatesTopic(true)).resolves.toBe(false);
  await expect(topic.syncValueUpdatesTopic(true)).resolves.toBe(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(2);

  mockMessaging.getToken.mockRejectedValueOnce(new Error('no token'));
  await expect(topic.syncValueUpdatesTopic(true, { force: true })).resolves.toBe(false);
});

test('a failed unsubscribe leaves no record that would skip the retry', async () => {
  await topic.syncValueUpdatesTopic(true);
  mockMessaging.unsubscribeFromTopic.mockRejectedValueOnce(new Error('offline'));
  await expect(topic.syncValueUpdatesTopic(false, { force: true })).resolves.toBe(false);
  // Back on: state is unknown, so it subscribes rather than trusting the old record.
  await topic.syncValueUpdatesTopic(true);
  expect(mockMessaging.subscribeToTopic).toHaveBeenCalledTimes(2);
});

test('iOS waits for the APNs token and gives up without one', async () => {
  jest.useFakeTimers();
  try {
    mockMessaging.getAPNSToken.mockResolvedValue(null);
    const result = topic.syncValueUpdatesTopic(true);
    await jest.advanceTimersByTimeAsync(15000);
    await expect(result).resolves.toBe(false);
    expect(mockMessaging.getAPNSToken).toHaveBeenCalledTimes(5);
    expect(mockMessaging.getToken).not.toHaveBeenCalled();
    expect(mockMessaging.subscribeToTopic).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

describe('askPermissionOnce', () => {
  test('setting off: no ask, and the flag stays unset for later', async () => {
    mockStore.set(topic.VALUE_UPDATES_SETTING_KEY, false);
    await topic.askPermissionOnce();
    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
    expect(mockStore.get(topic.PERMISSION_ASKED_KEY)).toBeUndefined();
  });

  test('already asked: nothing happens', async () => {
    mockStore.set(topic.PERMISSION_ASKED_KEY, true);
    await topic.askPermissionOnce();
    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
  });

  test.each([
    ['AUTHORIZED', 1],
    ['PROVISIONAL', 2],
  ])('already %s: no ask, but the flag is set', async (_, status) => {
    mockNotifee.getNotificationSettings.mockResolvedValue({ authorizationStatus: status });
    await topic.askPermissionOnce();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
    expect(mockStore.get(topic.PERMISSION_ASKED_KEY)).toBe(true);
  });

  test.each([
    ['NOT_DETERMINED', -1],
    ['DENIED', 0],
  ])('%s: asks once, never twice', async (_, status) => {
    mockNotifee.getNotificationSettings.mockResolvedValue({ authorizationStatus: status });
    await topic.askPermissionOnce();
    await topic.askPermissionOnce();
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
    expect(mockStore.get(topic.PERMISSION_ASKED_KEY)).toBe(true);
  });

  test('the flag is written before anything can fail, and it never throws', async () => {
    mockNotifee.getNotificationSettings.mockRejectedValue(new Error('native'));
    await expect(topic.askPermissionOnce()).resolves.toBeUndefined();
    expect(mockStore.get(topic.PERMISSION_ASKED_KEY)).toBe(true);
    mockNotifee.getNotificationSettings.mockResolvedValue({ authorizationStatus: -1 });
    await topic.askPermissionOnce();
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
  });
});

describe('scheduleValueUpdatesPermissionAsk', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('waits for onboarding + consent (the gate), then 3 s', async () => {
    topic.scheduleValueUpdatesPermissionAsk();
    await jest.advanceTimersByTimeAsync(60000);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();

    gate.markAdsReady();
    await jest.advanceTimersByTimeAsync(2900);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);

    // Scheduling again in the same session does nothing.
    topic.scheduleValueUpdatesPermissionAsk();
    await jest.advanceTimersByTimeAsync(10000);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  test('does not ask over a full-screen ad', async () => {
    adVisibility.setFullScreenAdVisible(true);
    gate.markAdsReady();
    topic.scheduleValueUpdatesPermissionAsk();
    await jest.advanceTimersByTimeAsync(20000);
    expect(mockNotifee.requestPermission).not.toHaveBeenCalled();

    adVisibility.setFullScreenAdVisible(false);
    await jest.advanceTimersByTimeAsync(2000);
    expect(mockNotifee.requestPermission).toHaveBeenCalledTimes(1);
  });

  test('an ad that stays up leaves the ask, and the flag, for the next launch', async () => {
    adVisibility.setFullScreenAdVisible(true);
    gate.markAdsReady();
    topic.scheduleValueUpdatesPermissionAsk();
    await jest.advanceTimersByTimeAsync(10 * 60000);
    expect(mockNotifee.getNotificationSettings).not.toHaveBeenCalled();
    expect(mockStore.get(topic.PERMISSION_ASKED_KEY)).toBeUndefined();
  });
});
