// While a private chat is open, every listener of the shared chat-meta
// subscription (Inbox rows, header badge) sees that chat with 0 unread, even
// as the partner's messages raise the server count.

const mockRealtime = { handler: null, status: null };
const mockRows = [];
jest.mock('../Code/Supabase/client', () => {
  const query = {
    select: () => query, eq: () => query, gt: () => query, order: () => query, update: () => query,
    limit: () => Promise.resolve({ data: [], error: null }),
    range: () => Promise.resolve({ data: mockRows.splice(0), error: null }),
  };
  const channel = {
    on: (_type, _filter, cb) => { mockRealtime.handler = cb; return channel; },
    subscribe: (cb) => { mockRealtime.status = cb; return channel; },
  };
  return {
    supabase: {
      from: () => query,
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});
jest.mock('../Code/Supabase/chatBackend', () => ({ ensureRealtimeAuth: () => Promise.resolve() }));

const {
  subscribeToChatMetaShared, refreshChatMetaShared, setActiveChatPartner, clearActiveChatPartner,
} = require('../Code/Supabase/chatMetaBackend');

const row = (partner, unread, ts) => ({
  owner_uid: 'me', partner_uid: partner, chat_id: `x_${partner}`, last_message: 'hi',
  timestamp_ms: ts, unread_count: unread, muted: false,
});
const realtimeUpdate = (r) => mockRealtime.handler({ eventType: 'UPDATE', new: r });
const flush = () => new Promise((r) => setImmediate(r));
// The channel subscribes after ensureRealtimeAuth resolves.
const connect = async () => { await flush(); mockRealtime.status('SUBSCRIBED'); await flush(); };

test('the open chat reads as 0 everywhere; leaving keeps it 0 and asks for the server reset', async () => {
  mockRows.push(row('amy', 2, 1000), row('bob', 1, 900));
  const seen = new Map();
  const unsub = subscribeToChatMetaShared('me', {
    onUpsert: (r) => seen.set(r.partnerId, r.unreadCount),
  });
  await connect();
  expect(seen.get('amy')).toBe(2);

  // Open Amy's chat: shown as read at once.
  setActiveChatPartner('me', 'amy');
  expect(seen.get('amy')).toBe(0);

  // Amy sends 3 messages while the chat is open: the server count rises,
  // the listeners keep seeing 0. Bob's chat is unaffected.
  realtimeUpdate(row('amy', 3, 1100));
  realtimeUpdate(row('amy', 4, 1200));
  realtimeUpdate(row('amy', 5, 1300));
  realtimeUpdate(row('bob', 2, 1250));
  expect(seen.get('amy')).toBe(0);
  expect(seen.get('bob')).toBe(2);

  // Pull-to-refresh re-reads the server rows: still masked.
  mockRows.push(row('amy', 5, 1300), row('bob', 2, 1250));
  await refreshChatMetaShared('me');
  expect(seen.get('amy')).toBe(0);

  // A late joiner (the Inbox mounting) gets the masked row too.
  const late = new Map();
  const unsubLate = subscribeToChatMetaShared('me', { onUpsert: (r) => late.set(r.partnerId, r.unreadCount) });
  expect(late.get('amy')).toBe(0);

  // Leave the chat: still 0 (no flash of 5), and the caller is told the
  // server still has unread so it must send the reset.
  expect(clearActiveChatPartner('me', 'amy')).toBe(true);
  expect(seen.get('amy')).toBe(0);
  expect(late.get('amy')).toBe(0);

  // A message after leaving counts again.
  realtimeUpdate(row('amy', 1, 1400));
  expect(seen.get('amy')).toBe(1);

  unsubLate();
  unsub();
});

test('clearing a chat that is no longer the active one does nothing', async () => {
  mockRows.push(row('cat', 3, 1000));
  const seen = new Map();
  const unsub = subscribeToChatMetaShared('me', { onUpsert: (r) => seen.set(r.partnerId, r.unreadCount) });
  await connect();

  setActiveChatPartner('me', 'dan');      // Dan's chat focused first
  expect(clearActiveChatPartner('me', 'cat')).toBe(false); // Cat's late blur
  realtimeUpdate(row('dan', 2, 1100));
  expect(seen.get('dan')).toBe(0);        // Dan is still the open chat
  expect(clearActiveChatPartner('me', 'dan')).toBe(true);
  unsub();
});

test('no server reset needed when nothing arrived while the chat was open', async () => {
  mockRows.push(row('eve', 0, 1000));
  const unsub = subscribeToChatMetaShared('me', { onUpsert: () => {} });
  await connect();
  setActiveChatPartner('me', 'eve');
  expect(clearActiveChatPartner('me', 'eve')).toBe(false);
  unsub();
});
