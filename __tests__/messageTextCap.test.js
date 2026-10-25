import {
  parseMessageText, capMessageText, MAX_DISPLAY_LENGTH, MAX_MESSAGE_LENGTH,
} from '../Code/ChatScreen/ChatHelper';

jest.mock('@react-native-clipboard/clipboard', () => ({ setString: jest.fn() }));
jest.mock('../i18n', () => ({ __esModule: true, default: { t: (k) => k } }));

// Bugs LOG 2026-10-23: stored messages of 67k (groups) and 153k (DMs) chars,
// posted in floods, froze phones that opened the chat.

const flatten = (parts) => (Array.isArray(parts) ? parts : [parts])
  .map((p) => (typeof p === 'string' ? p : p.props.children))
  .join('');

test('short and normal messages are untouched', () => {
  expect(capMessageText('hi')).toBe('hi');
  const atLimit = 'a'.repeat(MAX_DISPLAY_LENGTH);
  expect(capMessageText(atLimit)).toBe(atLimit);
  expect(capMessageText(null)).toBe(null);
  expect(MAX_MESSAGE_LENGTH).toBeLessThanOrEqual(MAX_DISPLAY_LENGTH);
});

test('a 153k-char one-line message is cut to the display cap', () => {
  const out = capMessageText('x'.repeat(152808));
  expect(out.length).toBe(MAX_DISPLAY_LENGTH + 1);
  expect(out.endsWith('…')).toBe(true);
});

test('the cut never splits an emoji', () => {
  const out = capMessageText('a'.repeat(MAX_DISPLAY_LENGTH - 1) + '🔥'.repeat(10));
  expect(out).toBe('a'.repeat(MAX_DISPLAY_LENGTH - 1) + '…');
  expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(out)).toBe(false);
});

test('parseMessageText draws at most the cap, links and mentions intact', () => {
  const huge = 'see https://adoptmevalues.app @trader ' + 'y'.repeat(150000);
  const parts = parseMessageText(huge);
  expect(flatten(parts).length).toBe(MAX_DISPLAY_LENGTH + 1);
  expect(parts.filter((p) => typeof p !== 'string')).toHaveLength(2);
});
