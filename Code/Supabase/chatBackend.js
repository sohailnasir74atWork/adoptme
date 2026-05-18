// Public-chat backend — thin wrapper around Supabase for Trader.jsx.
//
// Exposes an API shaped like the existing RTDB usage so the swap in
// Trader.jsx is a transport change, not a rewrite:
//   loadMessages, subscribeToMessages, sendMessage,
//   toggleReaction, subscribeToReactions,
//   getPinnedMessages, subscribeToPinned.
//
// Moderation ops (delete message, pin/unpin, clear pins, bump report count)
// are NOT in this module — RLS blocks them from the client by design.
// They will go through an admin Edge Function, added in a later step.

import { supabase } from './client';
import { getAuth, getIdToken } from '@react-native-firebase/auth';

// Hard-reset hook for the realtime layer.
//
// When a channel hits CHANNEL_ERROR / TIMED_OUT / CLOSED, simply removing
// it and creating a new one is NOT enough — the underlying WebSocket can
// stay wedged (bad auth handshake, network blip across laptop sleep,
// expired token cached by realtime) and every fresh channel inherits the
// dead socket. This:
//   1) force-refreshes the Firebase ID token so the next accessToken
//      callback returns a fresh JWT (the realtime client only invokes
//      that callback during its own connect — RN Firebase will return a
//      stale cached token until the underlying refresh fires).
//   2) Disconnects + reconnects the realtime socket so the next
//      subscribe re-handshakes from scratch.
// Force realtime to populate `accessTokenValue` BEFORE any channel
// subscribes. supabase-js fires its own internal setAuth on connect,
// but it's fire-and-forget — if the WebSocket opens before our async
// accessToken callback resolves (which now waits on Firebase auth
// restoration), the channel JOIN is sent with a null token and the
// server rejects with InvalidJWTToken. Awaiting setAuth() here closes
// that race.
export async function ensureRealtimeAuth() {
  try { await supabase.realtime.setAuth(); }
  catch (e) { console.warn('[realtime] ensureRealtimeAuth failed:', e?.message); }
}

export async function resetRealtimeAndAuth() {
  const u = getAuth().currentUser;
  let freshToken = null;
  if (u) {
    try { freshToken = await getIdToken(u, /* forceRefresh */ true); }
    catch (e) { console.warn('[realtime] token refresh failed:', e?.message); }
  }
  // Push the fresh JWT into the realtime client BEFORE reconnecting.
  // Without this, the realtime socket can keep using its cached token
  // (or fall back to the publishable key, which is not a JWT in the
  // sb_publishable_ format) and continue to fail with InvalidJWTToken.
  if (freshToken) {
    try { supabase.realtime.setAuth(freshToken); }
    catch (e) { console.warn('[realtime] setAuth failed:', e?.message); }
  }
  try { supabase.realtime.disconnect(); } catch {}
  try { supabase.realtime.connect(); }
  catch (e) { console.warn('[realtime] reconnect failed:', e?.message); }
}

// ---------------------------------------------------------------------
// Row ↔ UI-message mappers
// ---------------------------------------------------------------------
// DB columns use snake_case and group profile fields into JSONB.
// Existing UI code (MessagesList, BottomDrawer) reads flat camelCase
// fields (msg.avatar, msg.isPro, ...). We flatten on read and nest on
// write so the UI needs zero changes.
// ---------------------------------------------------------------------

export function fromRow(row) {
  if (!row) return null;
  const profile = row.sender_profile || {};
  const flags = row.role_flags || {};
  return {
    id: row.id,
    clientMsgId: row.client_msg_id ?? null,
    roomId: row.room_id,
    senderId: row.sender_id,
    sender: row.sender_name,
    text: row.text ?? null,
    gif: row.gif_url ?? null,
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,

    avatar: profile.avatar ?? null,
    isPro: !!profile.isPro,
    robloxUsernameVerified: !!profile.robloxUsernameVerified,
    topBadge: profile.topBadge ?? null,
    hasRecentGameWin: !!profile.hasRecentGameWin,
    profileFrame: profile.profileFrame ?? null,
    chatTextColor: profile.chatTextColor ?? null,
    chatBubbleBg: profile.chatBubbleBg ?? null,

    isAdmin: !!flags.isAdmin,
    isModerator: !!flags.isModerator,
    isBabyMod: !!flags.isBabyMod,
    isTrusted: !!flags.isTrusted,
    isCMSR: !!flags.isCMSR,
    isHelper: !!flags.isHelper,

    containsLink: !!row.contains_link,
    reportCount: row.report_count ?? 0,
    strikeCount: row.strike_count ?? null,
    flage: row.country_flag ?? null,
    OS: row.os ?? null,
    deleted: !!row.deleted,

    // ms epoch — keep the existing field name so UI timestamp formatting
    // code doesn't need to change.
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),

    reactions: {}, // populated separately by loadReactionsFor / subscribeToReactions
  };
}

function toInsertPayload(roomId, m) {
  return {
    room_id: roomId,
    client_msg_id: m.clientMsgId ?? null,
    sender_id: m.senderId,
    sender_name: m.sender,
    text: m.text ?? null,
    gif_url: m.gif ?? null,
    fruits: m.fruits ?? [],
    reply_to: m.replyTo ?? null,
    sender_profile: {
      avatar: m.avatar ?? null,
      isPro: !!m.isPro,
      robloxUsernameVerified: !!m.robloxUsernameVerified,
      topBadge: m.topBadge ?? null,
      hasRecentGameWin: !!m.hasRecentGameWin,
      profileFrame: m.profileFrame ?? null,
      chatTextColor: m.chatTextColor ?? null,
      chatBubbleBg: m.chatBubbleBg ?? null,
    },
    role_flags: {
      isAdmin: !!m.isAdmin,
      isModerator: !!m.isModerator,
      isBabyMod: !!m.isBabyMod,
      isTrusted: !!m.isTrusted,
      isCMSR: !!m.isCMSR,
      isHelper: !!m.isHelper,
    },
    contains_link: !!m.containsLink,
    strike_count: m.strikeCount ?? null,
    country_flag: m.flage ?? null,
    os: m.OS ?? null,
  };
}

// ---------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------

// Paginated fetch. `before` is a cursor: { createdAt, id }.
// Returns newest-first (descending), same order the UI renders.
export async function loadMessages(roomId, { limit = 20, before = null } = {}) {
  let q = supabase
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (before?.createdAt) {
    // Composite-cursor pagination. Postgres evaluates this as a row
    // comparison; the (room_id, created_at desc, id desc) index serves it.
    q = q.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;
  if (error) throw error;
  return data.map(fromRow);
}

// Forward pagination: fetch messages strictly newer than `since`.
// Used for gap-fill on reconnect so events missed while the WebSocket
// was dead/resubscribing are backfilled. Returns newest-first to match
// the render order used everywhere else.
export async function loadMessagesSince(roomId, since = null, { limit = 200 } = {}) {
  let q = supabase
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (since?.createdAt) {
    // Symmetric to loadMessages' `before` cursor, but `>`.
    q = q.or(
      `created_at.gt.${since.createdAt},and(created_at.eq.${since.createdAt},id.gt.${since.id})`,
    );
  }

  const { data, error } = await q;
  if (error) throw error;
  return data.map(fromRow);
}

// Realtime INSERT/UPDATE/DELETE stream for a room.
// `onStatus` receives every subscription transition — callers use it to
// trigger gap-fill when the channel recovers from CHANNEL_ERROR/TIMED_OUT/
// CLOSED → SUBSCRIBED. Returns an unsubscribe function.
export function subscribeToMessages(roomId, { onInsert, onUpdate, onDelete, onStatus } = {}) {
  const channel = supabase
    .channel(`room-messages:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => { onInsert?.(fromRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => { onUpdate?.(fromRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => { onDelete?.(payload.old?.id); },
    )
    .subscribe((status, err) => {
      onStatus?.(status, err);
    });

  return () => { supabase.removeChannel(channel); };
}

// Soft-delete a single message. Any authenticated user can call this at
// the RLS level; the client UI restricts it to admins/mods.
export async function softDeleteMessage(messageId, deletedBy) {
  const { error } = await supabase
    .from('messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy ?? null,
    })
    .eq('id', messageId);
  if (error) throw error;
}

// Soft-delete the last N messages from a given sender in a room.
// Postgres doesn't let UPDATE have ORDER BY + LIMIT in one query via the
// REST API, so we fetch the ids first then bulk-update. Two round-trips
// is fine for an admin moderation action.
export async function softDeleteMessagesBySender(roomId, senderId, {
  limit = 60, deletedBy = null,
} = {}) {
  const { data, error: selectErr } = await supabase
    .from('messages')
    .select('id')
    .eq('room_id', roomId)
    .eq('sender_id', senderId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}

// Report a message. First report bumps report_count to 1. Second report
// (count already >= 1) soft-deletes. Banning the sender is the caller's
// responsibility (still on RTDB via banned_users_by_email).
// Returns { action: 'reported' | 'deleted' }.
export async function reportMessage(messageId, reporterId) {
  const { data, error: selectErr } = await supabase
    .from('messages')
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!data) throw new Error('Message not found');

  if ((data.report_count ?? 0) >= 1) {
    const { error } = await supabase
      .from('messages')
      .update({
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: reporterId ?? null,
      })
      .eq('id', messageId);
    if (error) throw error;
    return { action: 'deleted' };
  }

  const { error } = await supabase
    .from('messages')
    .update({ report_count: 1 })
    .eq('id', messageId);
  if (error) throw error;
  return { action: 'reported' };
}

// Insert a new message. If `message.clientMsgId` is present and a row
// with the same (room_id, client_msg_id) already exists (i.e. the caller
// retried after a network hiccup), return that existing row instead of
// throwing. This gives the retry queue at-least-once semantics without
// ever producing a duplicate row.
export async function sendMessage(roomId, message) {
  const payload = toInsertPayload(roomId, message);
  const { data, error } = await supabase
    .from('messages')
    .insert(payload)
    .select()
    .single();

  if (error) {
    // Postgres unique_violation — our client_msg_id collided, meaning a
    // previous attempt actually landed. Fetch and return it so the
    // caller can upgrade its optimistic placeholder normally.
    if (error.code === '23505' && payload.client_msg_id) {
      const { data: existing, error: selectErr } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .eq('client_msg_id', payload.client_msg_id)
        .maybeSingle();
      if (selectErr) throw selectErr;
      if (existing) return fromRow(existing);
    }
    throw error;
  }
  return fromRow(data);
}

// ---------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------
// DB stores one row per (message_id, user_id). UI expects a
// `msg.reactions = { [userId]: emoji }` map. We keep that shape.
// ---------------------------------------------------------------------

// Fetch all reactions for a set of messages, return { [messageId]: { [userId]: emoji } }.
export async function loadReactionsFor(messageIds) {
  if (!messageIds?.length) return {};
  const { data, error } = await supabase
    .from('message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);
  if (error) throw error;
  const out = {};
  for (const r of data) {
    if (!out[r.message_id]) out[r.message_id] = {};
    out[r.message_id][r.user_id] = r.emoji;
  }
  return out;
}

// Toggle a user's reaction on a message.
//   - if no current reaction → set `emoji`
//   - if current reaction === `emoji` → clear it
//   - else → replace with `emoji`
// Returns the new emoji (or null if cleared).
export async function toggleReaction(messageId, userId, emoji) {
  const { data: existing } = await supabase
    .from('message_reactions')
    .select('emoji')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing?.emoji === emoji) {
    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', userId);
    if (error) throw error;
    return null;
  }

  const { error } = await supabase
    .from('message_reactions')
    .upsert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
  return emoji;
}

// Reactions realtime was intentionally dropped: message_reactions has no
// room_id column, so a Realtime channel can't scope its broadcasts — every
// reaction in the app fans out to every connected user, which blows the
// Realtime-messages quota fast. Self-reactions stay instant via optimistic
// update in the handler; other users' reactions refresh on pagination /
// screen reload. If we later need live cross-user reactions, denormalize
// room_id onto message_reactions and subscribe with a room filter.

// ---------------------------------------------------------------------
// Pinned messages
// ---------------------------------------------------------------------
// The pinned list holds references — we fetch the underlying message rows
// together via a join so the UI gets the live message content (unlike
// RTDB, which stored a stale snapshot).
// ---------------------------------------------------------------------

export async function getPinnedMessages(roomId) {
  const { data, error } = await supabase
    .from('pinned_messages')
    .select('id, pinned_by, pinned_at, message:messages(*)')
    .eq('room_id', roomId)
    .order('pinned_at', { ascending: false });
  if (error) throw error;
  return data
    .filter((p) => p.message && !p.message.deleted)
    .map((p) => ({
      pinId: p.id,
      pinnedBy: p.pinned_by,
      pinnedAt: p.pinned_at ? new Date(p.pinned_at).getTime() : null,
      ...fromRow(p.message),
    }));
}

export function subscribeToPinned(roomId, { onChange } = {}) {
  const channel = supabase
    .channel(`pinned:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'pinned_messages', filter: `room_id=eq.${roomId}` },
      () => { onChange?.(); }, // UI re-fetches with getPinnedMessages
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

// Pin a message. Caller must pass the admin/mod user's Firebase UID (used
// both to satisfy the RLS insert policy and as an audit trail).
export async function pinMessage(roomId, messageId, pinnedBy) {
  const { data, error } = await supabase
    .from('pinned_messages')
    .insert({ room_id: roomId, message_id: messageId, pinned_by: pinnedBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Unpin by pin row id (the `pinId` returned by getPinnedMessages).
export async function unpinMessage(pinId) {
  const { error } = await supabase
    .from('pinned_messages')
    .delete()
    .eq('id', pinId);
  if (error) throw error;
}

// Remove every pin for a room.
export async function clearPinnedForRoom(roomId) {
  const { error } = await supabase
    .from('pinned_messages')
    .delete()
    .eq('room_id', roomId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Room id helpers
// ---------------------------------------------------------------------
// Maps the `path` field from the CHANNELS array in Trader.jsx
// ('chat_new', 'chat_es', ...) to the Supabase room_id ('public:en', ...).
// ---------------------------------------------------------------------

const RTDB_PATH_TO_ROOM_ID = {
  chat_new: 'public:en',
  chat_es: 'public:es',
  chat_pt: 'public:pt',
  chat_fr: 'public:fr',
  chat_de: 'public:de',
  chat_tr: 'public:tr',
  chat_it: 'public:it',
  chat_hy: 'public:hy',
  chat_ar: 'public:ar',
  chat_ja: 'public:ja',
  chat_ko: 'public:ko',
  chat_ru: 'public:ru',
};

export function roomIdFromRtdbPath(path) {
  return RTDB_PATH_TO_ROOM_ID[path] ?? null;
}
