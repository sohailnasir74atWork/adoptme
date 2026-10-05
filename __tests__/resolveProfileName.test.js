// resolveProfile: a chat message stores its sender's name/avatar as they
// were when it was sent. After a rename, a profile fetched later must win
// over older messages — but never over a message sent after the fetch.

jest.mock('react-native-mmkv', () => {
  const store = new Map();
  return {
    createMMKV: () => ({
      getString: (k) => store.get(k),
      set: (k, v) => store.set(k, v),
      remove: (k) => store.delete(k),
    }),
  };
});
jest.mock('../Code/Supabase/userBackend', () => ({}));
jest.mock('@react-native-firebase/database', () => ({ ref: jest.fn(), get: jest.fn() }));

const { resolveProfile, setCachedProfile, seedFromMessage } = require('../Code/Helper/profileCache');

describe('resolveProfile name freshness', () => {
  test('profile fetched after the message wins', () => {
    const sentAt = Date.now() - 60_000;
    setCachedProfile('u1', { displayName: 'NewName', avatar: 'new.png' });
    const p = resolveProfile({ senderId: 'u1', sender: 'OldName', avatar: 'old.png', timestamp: sentAt });
    expect(p.displayName).toBe('NewName');
    expect(p.avatar).toBe('new.png');
  });

  test('message sent after the fetch wins', () => {
    setCachedProfile('u2', { displayName: 'CachedName', avatar: 'c.png' });
    const p = resolveProfile({ senderId: 'u2', sender: 'JustRenamed', avatar: 'j.png', timestamp: Date.now() + 1000 });
    expect(p.displayName).toBe('JustRenamed');
    expect(p.avatar).toBe('j.png');
  });

  test("assembler placeholder 'Anonymous' never replaces a real name", () => {
    setCachedProfile('u3', { displayName: 'Anonymous', avatar: null });
    const p = resolveProfile({ senderId: 'u3', sender: 'Real', avatar: 'r.png', timestamp: Date.now() - 1000 });
    expect(p.displayName).toBe('Real');
    expect(p.avatar).toBe('r.png');
  });

  test('a cache seeded from another message is not treated as newer', () => {
    seedFromMessage({ senderId: 'u4', sender: 'FromOldMessage', avatar: 'o.png' });
    const p = resolveProfile({ senderId: 'u4', sender: 'FromThisMessage', avatar: 't.png', timestamp: Date.now() - 1000 });
    expect(p.displayName).toBe('FromThisMessage');
  });

  test('no cache: the message copy', () => {
    const p = resolveProfile({ senderId: 'nobody', sender: 'Msg', timestamp: Date.now() });
    expect(p.displayName).toBe('Msg');
  });
});
