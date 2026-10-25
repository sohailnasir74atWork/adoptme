/**
 * How many message bubbles redraw in a DM when something small changes?
 * Every bubble owns one popup <Menu>, so Menu renders = bubble renders.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

const mockCounts = { menu: 0 };
jest.mock('react-native-popup-menu', () => ({
  Menu: ({ children }) => { mockCounts.menu += 1; return children; },
  MenuTrigger: ({ children }) => children,
  MenuOptions: () => null,
  MenuOption: () => null,
}));
const mockGlobal = { theme: 'light', isAdmin: false, api: '', freeTranslation: false };
jest.mock('../Code/GlobelStats', () => ({ useGlobalState: () => mockGlobal }));
const mockLocal = {
  localState: { showReadReceipts: true }, updateLocalState: () => {},
  canTranslate: () => true, incrementTranslationCount: () => {}, getRemainingTranslationTries: () => 5,
};
jest.mock('../Code/LocalGlobelStats', () => ({ useLocalState: () => mockLocal }));
const mockStyles = {};
jest.mock('../Code/ChatScreen/Style', () => ({ getStyles: () => mockStyles }));
jest.mock('../Code/ChatScreen/ReportPopUp', () => () => null);
const mockT = (k, o) => (o && o.defaultValue) || k;
const mockI18n = { t: mockT };
jest.mock('react-i18next', () => ({ useTranslation: () => mockI18n }));
jest.mock('@react-native-clipboard/clipboard', () => ({ setString: () => {} }));
const mockHaptic = { triggerHapticFeedback: () => {} };
jest.mock('../Code/Helper/HepticFeedBack', () => ({ useHaptic: () => mockHaptic }));
jest.mock('../Code/Helper/MessageHelper', () => ({ showSuccessMessage: () => {} }));
jest.mock('axios', () => ({ post: () => Promise.resolve({}) }));
jest.mock('../i18n', () => ({ getDeviceLanguage: () => 'en' }));
jest.mock('react-native-vector-icons/Ionicons', () => () => null);
jest.mock('../Code/Helper/filter', () => ({ FRUIT_KEYWORDS: [] }));
const mockTranslation = { handleTranslate: () => {} };
jest.mock('../Code/Helper/useMessageTranslation', () => ({ useMessageTranslation: () => mockTranslation }));
// Like the real MMKV cache: a fresh object on every read.
jest.mock('../Code/Helper/profileCache', () => ({
  getCachedProfile: (uid) => (uid === 'friend' ? { chatBubbleBg: { color: '#eee', darkColor: '#333' } } : null),
}));
jest.mock('../Code/Helper/valueSources', () => ({ sourceStatement: () => '', sourceOfItems: () => null }));
jest.mock('../Code/Helper/contrastHelper', () => ({
  getSafeTextColor: (c) => c, RainbowText: ({ children }) => children,
  isMultiColorText: () => false, getMultiColorPalette: () => [],
}));
jest.mock('../Code/ChatScreen/PrivateChat/Scamwarning', () => () => null);
const mockNav = { navigate: () => {} };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
jest.mock('../Code/Helper/Environment', () => ({ colors: {} }));
jest.mock('../Code/ChatScreen/ChatHelper', () => ({ capMessageText: (s) => s }));

const PrivateMessageList = require('../Code/ChatScreen/PrivateChat/PrivateMessageList').default;

const BASE = Date.UTC(2026, 9, 21, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const msg = (i, ts = BASE + i * 60000) => ({
  id: `m${i}`, senderId: i % 2 ? 'me' : 'friend',
  text: `message ${i}`, timestamp: ts,
});
const history = Array.from({ length: 30 }, (_, i) => msg(i)).reverse(); // newest first

const noop = () => {};
const onReply = noop; // PrivateChat passes a stable callback after the fix
const listProps = (overrides) => ({
  userId: 'me', user: { id: 'me' }, selectedUser: { senderId: 'friend' },
  handleLoadMore: noop, refreshing: false, onRefresh: noop, isBanned: false,
  onReply, canRate: false, hasRated: false, setShowRatingModal: noop,
  chatKey: 'friend_me', otherLastRead: null, onDeleteMessage: noop, onTradeInvite: noop,
  ...overrides,
});

const dateLabels = (renderer) => renderer.root
  .findAll((n) => n.type === 'Text' && typeof n.props.children === 'string'
    && /^(Today|Yesterday|[A-Z][a-z]{2} \d)/.test(n.props.children))
  .map((n) => n.props.children);

describe('DM bubbles redrawn per change', () => {
  let renderer;
  let props;
  const draw = async (next) => {
    props = next;
    mockCounts.menu = 0;
    await act(async () => { renderer.update(<PrivateMessageList {...props} />); });
    return mockCounts.menu;
  };

  beforeAll(async () => {
    props = listProps({ messages: history });
    await act(async () => { renderer = ReactTestRenderer.create(<PrivateMessageList {...props} />); });
  });
  afterAll(() => act(() => renderer.unmount()));

  test('one new message arrives', async () => {
    const n = await draw({ ...props, messages: [msg(30), ...props.messages] });
    console.log('[bubbles] new message:', n);
    expect(n).toBe(1);
  });

  test('the partner opens the chat and reads everything', async () => {
    const n = await draw({ ...props, otherLastRead: BASE + 30 * 60000 });
    console.log('[bubbles] read receipt:', n);
    // Every rendered bubble of mine turns blue; the partner's don't redraw.
    const mine = props.messages.slice(0, 15).filter((m) => m.senderId === 'me').length;
    expect(n).toBeLessThanOrEqual(mine);
  });

  test('a keystroke in the input (parent re-renders, list props unchanged)', async () => {
    const n = await draw({ ...props });
    console.log('[bubbles] keystroke:', n);
    expect(n).toBe(0);
  });

  test('a keystroke while the parent passes a new onReply each render (HEAD PrivateChat)', async () => {
    const n = await draw({ ...props, onReply: (m) => onReply(m) });
    console.log('[bubbles] keystroke, inline onReply:', n);
    expect(n).toBe(0);
  });
});

describe('date separators after an older page loads', () => {
  test('the separator moves to the right message', async () => {
    let renderer;
    const today = Array.from({ length: 5 }, (_, i) => msg(i)).reverse();
    const base = listProps({ messages: today });
    await act(async () => { renderer = ReactTestRenderer.create(<PrivateMessageList {...base} />); });
    const before = dateLabels(renderer);
    // Older page (the day before) appended at the end of the newest-first list.
    const older = Array.from({ length: 5 }, (_, i) => msg(100 + i, BASE - DAY + i * 60000)).reverse();
    await act(async () => { renderer.update(<PrivateMessageList {...base} messages={[...today, ...older]} />); });
    const after = dateLabels(renderer);
    console.log('[dates] before:', JSON.stringify(before), 'after:', JSON.stringify(after));
    expect(before.length).toBe(1);
    // Today's oldest message keeps its separator (its new neighbour is on
    // another day) and yesterday's oldest gets one.
    expect(after.length).toBe(2);
    act(() => renderer.unmount());
  });
});
