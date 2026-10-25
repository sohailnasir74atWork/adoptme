/**
 * How many times do the chat screens redraw when realtime updates arrive?
 *
 * Every screen is replaced by a counter, the Supabase subscriptions by
 * emitters we drive by hand, and the real React Navigation native stack sits
 * in between — the redraws we care about come from how ChatStack hands its
 * screens to that navigator. Adopt Me does not call enableFreeze, so no
 * mounted screen is frozen.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockRenders = {};
const mockCount = (name) => { mockRenders[name] = (mockRenders[name] || 0) + 1; };
const mockScreen = (name, { memo = false } = {}) => {
  const Screen = () => { mockCount(name); return null; };
  return { __esModule: true, default: memo ? require('react').memo(Screen) : Screen };
};

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../Code/ChatScreen/GroupChat/Trader', () => mockScreen('publicChat'));
jest.mock('../Code/ChatScreen/PrivateChat/PrivateChat', () => mockScreen('dm'));
jest.mock('../Code/ChatScreen/GroupChat/InboxScreen', () => mockScreen('inbox', { memo: true }));
const mockLastGroups = { value: null };
jest.mock('../Code/ChatScreen/GroupChat/GroupsScreen', () => ({
  __esModule: true,
  default: ({ groups }) => { mockCount('groups'); mockLastGroups.value = groups; return null; },
}));
jest.mock('../Code/ChatScreen/GroupChat/GroupChatScreen', () => mockScreen('groupChat'));
jest.mock('../Code/ChatScreen/PrivateChat/PrivateChatHeader', () => mockScreen('dmHeader', { memo: true }));
jest.mock('../Code/ChatScreen/PrivateChat/BlockUserList', () => mockScreen('blocked'));
jest.mock('../Code/ChatScreen/PrivateChat/ImageViewer', () => mockScreen('imageViewer'));
jest.mock('../Code/AppHelper/AdminDashboard', () => mockScreen('admin'));
// The real header is React.memo too.
jest.mock('../Code/ChatScreen/GroupChat/CommunityChatHeader', () => mockScreen('chatHeader', { memo: true }));

const mockGlobal = { user: { id: 'me' }, appdatabase: {} };
jest.mock('../Code/GlobelStats', () => ({ useGlobalState: () => mockGlobal }));
const mockLocal = { localState: { bannedUsers: [] }, updateLocalState: () => {} };
jest.mock('../Code/LocalGlobelStats', () => ({ useLocalState: () => mockLocal }));
const mockHaptic = { triggerHapticFeedback: () => {} };
jest.mock('../Code/Helper/HepticFeedBack', () => ({ useHaptic: () => mockHaptic }));
const mockT = (k) => k;
const mockI18n = { t: mockT };
jest.mock('react-i18next', () => ({ useTranslation: () => mockI18n }));

// Hand-driven realtime: tests call dmMessage(...) / groupMessage(...).
const mockEmit = { dmHandlers: new Set(), groupHandlers: new Set() };
jest.mock('../Code/Supabase/chatMetaBackend', () => ({
  subscribeToChatMetaShared: (uid, h) => {
    mockEmit.dmHandlers.add(h);
    h.onReady?.();
    return () => mockEmit.dmHandlers.delete(h);
  },
  resetUnreadCount: () => Promise.resolve(),
  setActiveChatPartner: () => {},
  clearActiveChatPartner: () => false,
}));
jest.mock('../Code/Supabase/groupMetaBackend', () => ({
  subscribeToGroupMetaShared: (uid, h) => {
    mockEmit.groupHandlers.add(h);
    h.onReady?.();
    return () => mockEmit.groupHandlers.delete(h);
  },
}));

// Not in the jest environment; the app gets it from React Native.
if (typeof global.requestIdleCallback !== 'function') {
  global.requestIdleCallback = (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 1);
}

const { NavigationContainer, createNavigationContainerRef } = require('@react-navigation/native');
const { ChatStack } = require('../Code/ChatScreen/ChatNavigator');

// The badge store is part of the fix; the "before" run of this file has none.
let badgeStore = null;
try { badgeStore = require('../Code/ChatScreen/chatBadgeStore'); } catch { badgeStore = null; }
const readBadges = () => {
  let value;
  const Probe = () => { value = badgeStore.useChatBadges(); return null; };
  let r;
  act(() => { r = ReactTestRenderer.create(<Probe />); });
  act(() => r.unmount());
  return value;
};

// native-stack only keeps the screen right under the focused one awake on
// Fabric (the new architecture this app runs on). It checks for this key at
// render time; set after the imports, which read it as an object.
global.nativeFabricUIManager = undefined;

const theme = { colors: { background: '#fff', text: '#000' } };
const reset = () => Object.keys(mockRenders).forEach((k) => { mockRenders[k] = 0; });

let unread = 0;
const lastUnread = {}; // partnerId -> last unreadCount sent
const dmMessage = (partnerId = 'friend') => {
  unread += 1;
  lastUnread[partnerId] = unread;
  mockEmit.dmHandlers.forEach((h) => h.onUpsert?.({
    partnerId, chatId: 'friend_me', lastMessage: `hi ${unread}`, timestamp: unread, unreadCount: unread,
  }));
};
let groupSeq = 0;
const groupMessage = () => {
  groupSeq += 1;
  mockEmit.groupHandlers.forEach((h) => h.onUpsert?.({
    groupId: 'busy-group', groupName: 'Busy', lastMessage: `m${groupSeq}`,
    lastMessageTimestamp: groupSeq, unreadCount: groupSeq,
  }));
};

// One realtime event = one websocket frame = its own JS task, so each one is
// flushed by itself (React does not batch them together on the phone either).
// `gapMs` spaces the events out in (fake) time.
const each = async (n, fn, gapMs = 0) => {
  for (let i = 0; i < n; i += 1) {
    await act(async () => { fn(); jest.advanceTimersByTime(gapMs); });
  }
  // Let any throttled list flush land.
  await act(async () => { jest.advanceTimersByTime(3000); });
};

describe('chat stack redraws per realtime update', () => {
  let renderer;
  const nav = createNavigationContainerRef();

  beforeAll(async () => {
    jest.useFakeTimers();
    await act(async () => {
      renderer = ReactTestRenderer.create(
        <NavigationContainer ref={nav}>
          <ChatStack selectedTheme={theme} setChatFocused={() => {}} modalVisibleChatinfo={false} setModalVisibleChatinfo={() => {}} />
        </NavigationContainer>,
      );
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
  });

  afterAll(() => {
    act(() => renderer.unmount());
    jest.useRealTimers();
  });

  test('Inbox open: 50 DMs + 50 group messages', async () => {
    await act(async () => { nav.navigate('Inbox'); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, dmMessage);
    await each(50, groupMessage);
    console.log('[renders] Inbox open, 50 DMs + 50 group msgs:', JSON.stringify(mockRenders));
    // No enableFreeze here: the public chat under the Inbox stays mounted and live.
    expect(mockRenders.publicChat || 0).toBe(0);
  });

  test('Inbox open: 20 DMs, one every 600 ms (slower than the old debounce)', async () => {
    reset();
    await each(20, dmMessage, 600);
    console.log('[renders] Inbox open, 20 DMs 600 ms apart:', JSON.stringify(mockRenders));
    expect(mockRenders.publicChat || 0).toBe(0);
  });

  test('DM open: 50 messages from another chat + 50 group messages', async () => {
    await act(async () => {
      nav.navigate('PrivateChat', { selectedUser: { senderId: 'friend', sender: 'Friend' } });
    });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    await each(50, () => dmMessage('someone-else'));
    await each(50, groupMessage);
    console.log('[renders] DM open, 50 other DMs + 50 group msgs:', JSON.stringify(mockRenders));
    expect(mockRenders.dm || 0).toBe(0);
    expect(mockRenders.inbox || 0).toBe(0);
    expect(mockRenders.publicChat || 0).toBe(0);
  });

  test('badges follow the realtime counts', async () => {
    expect(badgeStore).not.toBeNull();
    // 'friend' / 'someone-else' share one running counter; the badge is the
    // sum of the last count sent per chat, the group at its latest count.
    const total = lastUnread.friend + lastUnread['someone-else'];
    expect(readBadges()).toEqual({ dm: total, group: groupSeq });
    act(() => badgeStore.acknowledgeDmBadge());
    expect(readBadges().dm).toBe(0);
    const friendBefore = lastUnread.friend;
    await each(1, () => dmMessage('friend'));
    // Only what is new since the tap shows.
    expect(readBadges().dm).toBe(lastUnread.friend - friendBefore);
  });

  test('Groups open: 50 group messages over 2.5 s redraw the list a few times, not 50', async () => {
    await act(async () => { nav.navigate('Groups'); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    reset();
    let maxLag = 0;
    for (let i = 0; i < 50; i += 1) {
      await act(async () => { groupMessage(); jest.advanceTimersByTime(50); });
      const shown = mockLastGroups.value?.[0]?.lastMessageTimestamp || 0;
      maxLag = Math.max(maxLag, groupSeq - shown);
    }
    await act(async () => { jest.advanceTimersByTime(3000); });
    console.log('[renders] Groups open, 50 group msgs in 2.5 s:', JSON.stringify(mockRenders), 'max lag (msgs behind):', maxLag);
    expect(mockRenders.groups).toBeLessThanOrEqual(8);
    // The list keeps up during the stream (a restarting debounce would not).
    expect(maxLag).toBeLessThanOrEqual(10);
    expect(mockLastGroups.value[0].lastMessage).toBe(`m${groupSeq}`);
  });
});
