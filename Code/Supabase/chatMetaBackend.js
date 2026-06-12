// Chat-list metadata backend — Supabase mirror of RTDB /chat_meta_data.
//
// API shaped to match the existing onChildAdded/onChildChanged/onChildRemoved
// usage in ChatNavigator.js and InboxScreen.jsx so the swap is a transport
// change, not a UI rewrite. Each row exposed to the UI is flattened back to
// the camelCase shape the listeners already consume:
//   { chatId, lastMessage, timestamp, receiverId, receiverName,
//     receiverAvatar, unreadCount, muted }
//
// Writes (mute toggles, unreadCount=0 on chat enter, sender's increment, …)
// stay on RTDB — see ChatNavigator.js / InboxScreen.jsx / PrivateChat.jsx.
// A Cloud Function (mirrorChatMetaToSupabase) tails those RTDB writes and
// upserts here, so this table is read-only from the client.

import { supabase } from './client';

// -----------------------------------------------------------------
// Row mapper — DB snake_case → UI camelCase
// -----------------------------------------------------------------
export function fromChatMetaRow(row) {
  if (!row) return null;
  return {
    partnerId: row.partner_uid,
    chatId: row.chat_id ?? null,
    lastMessage: row.last_message ?? null,
    timestamp: row.timestamp_ms ?? 0,
    receiverId: row.receiver_id ?? null,
    receiverName: row.receiver_name ?? null,
    receiverAvatar: row.receiver_avatar ?? null,
    unreadCount: row.unread_count ?? 0,
    muted: !!row.muted,
    ownerLastRead: row.owner_last_read_ms ?? 0,
    partnerLastRead: row.partner_last_read_ms ?? 0,
  };
}

// -----------------------------------------------------------------
// Initial load — Supabase realtime doesn't replay history, so the
// caller fetches once on attach and then keeps state in sync via the
// realtime channel.
//
// Paginated via .range() because Supabase enforces a server-side
// max_rows cap (default 1000) that `.limit(N)` does NOT override. Heavy
// users (Tee was at 1,411) silently lost rows past row 1000 — old chats
// whose row got bumped while the app was closed were invisible until
// the partner happened to send while the user was online. Ordering by
// timestamp_ms DESC keeps the most-recent chats in the first page so
// the UI populates quickly even before later pages land.
// -----------------------------------------------------------------
const CHAT_META_PAGE = 1000;

// Egress: only the columns fromChatMetaRow actually maps. Dropping select('*')
// avoids shipping updated_at/created_at/owner_uid/id on every row of a load
// that spans the whole 292 MB table for heavy inboxes.
const CHAT_META_COLS =
  'partner_uid,chat_id,last_message,timestamp_ms,receiver_id,receiver_name,' +
  'receiver_avatar,unread_count,muted,owner_last_read_ms,partner_last_read_ms';

export async function loadChatMeta(ownerUid) {
  if (!ownerUid) return [];
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('chat_meta_data')
      .select(CHAT_META_COLS)
      .eq('owner_uid', ownerUid)
      .order('timestamp_ms', { ascending: false, nullsFirst: false })
      .range(from, from + CHAT_META_PAGE - 1);
    if (error) {
      console.warn('[chatMetaBackend] loadChatMeta error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) out.push(fromChatMetaRow(row));
    if (data.length < CHAT_META_PAGE) break;
    from += CHAT_META_PAGE;
  }
  return out;
}

// -----------------------------------------------------------------
// Reset unread count directly in Supabase — called when user opens a
// chat so the badge clears instantly. Phase 5 clean-cut: new app builds
// are Supabase-only for chat_meta_data writes (PrivateChat send no
// longer touches RTDB), so this is the canonical write, not an
// optimistic shortcut. Old-app builds still write RTDB and the mirror
// CF replays those here.
// -----------------------------------------------------------------
export async function resetUnreadCount(ownerUid, partnerUid) {
  if (!ownerUid || !partnerUid) return;
  await supabase
    .from('chat_meta_data')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid);
  // Errors are intentionally swallowed — the realtime subscription
  // will reconcile state on the next upstream event.
}

// -----------------------------------------------------------------
// Write the caller's lastRead timestamp into BOTH sides of the chat
// pair via set_chat_last_read RPC. Backed by 017_chat_lastread.sql —
// the RPC updates owner_last_read_ms on the caller's row and
// partner_last_read_ms on the partner's row in one round-trip so the
// blue-tick threshold rides on the existing chat_meta_data realtime
// stream (no separate read-receipts channel).
//
// Returns the ms-epoch timestamp written, or 0 on failure / no auth.
// -----------------------------------------------------------------
export async function setChatLastRead(partnerUid) {
  if (!partnerUid) return 0;
  const { data, error } = await supabase.rpc('set_chat_last_read', {
    p_partner_uid: partnerUid,
  });
  if (error) {
    console.warn('[chatMetaBackend] setChatLastRead error:', error.message);
    return 0;
  }
  return Number(data) || 0;
}

// -----------------------------------------------------------------
// Single-row subscription for the open private-chat screen. Mirrors
// the granularity of the prior RTDB `onValue` on
// /private_messages/{chatKey}/lastRead/{partner}: one channel per open
// chat, fires `onChange(partnerLastReadMs)` on every UPDATE that
// touches the row.
//
// Realtime postgres_changes only supports a single equality filter, so
// we filter by owner_uid and reject non-matching partner rows in JS.
// That's cheap — for a logged-in user, the only frequent traffic on
// chat_meta_data is their own row anyway.
// -----------------------------------------------------------------
export function subscribeToChatLastRead(ownerUid, partnerUid, onChange) {
  if (!ownerUid || !partnerUid) return () => {};

  let cancelled = false;
  // lastEmitted guards against the seed-read landing AFTER a realtime
  // UPDATE: partner_last_read_ms is monotonic, so anything less-or-
  // equal is a stale read we should drop.
  let lastEmitted = 0;
  const emit = (ms) => {
    const v = Number(ms) || 0;
    if (cancelled || v <= lastEmitted) return;
    lastEmitted = v;
    onChange?.(v);
  };

  const topic = `chat-lastread:${ownerUid}:${partnerUid}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => {
        if (payload.new?.partner_uid !== partnerUid) return;
        emit(payload.new.partner_last_read_ms);
      },
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => {
        if (payload.new?.partner_uid !== partnerUid) return;
        emit(payload.new.partner_last_read_ms);
      },
    )
    .subscribe();

  // Seed with current value so the UI doesn't sit at 0 until the next
  // partner-side updateLastRead lands.
  supabase
    .from('chat_meta_data')
    .select('partner_last_read_ms')
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error || !data) return;
      emit(data.partner_last_read_ms);
    });

  return () => {
    cancelled = true;
    try { supabase.removeChannel(channel); } catch {}
  };
}

// -----------------------------------------------------------------
// Toggle mute flag for one side of a chat pair. RLS (007_meta_writable)
// permits either participant to UPDATE, but we always write the owner's
// row — mute is a per-user preference, not symmetric.
// -----------------------------------------------------------------
export async function setChatMuted(ownerUid, partnerUid, muted) {
  if (!ownerUid || !partnerUid) return;
  const { error } = await supabase
    .from('chat_meta_data')
    .update({ muted: !!muted, updated_at: new Date().toISOString() })
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid);
  if (error) throw error;
}

// -----------------------------------------------------------------
// Delete the caller's inbox row for a single partner. One-sided on
// purpose: matches the prior RTDB `remove()` behaviour where the other
// participant kept their copy of the conversation in their inbox.
// RLS (007_meta_writable) gates DELETE to owner_uid = firebase_uid().
// -----------------------------------------------------------------
export async function deleteChatMeta(ownerUid, partnerUid) {
  if (!ownerUid || !partnerUid) return;
  const { error } = await supabase
    .from('chat_meta_data')
    .delete()
    .eq('owner_uid', ownerUid)
    .eq('partner_uid', partnerUid);
  if (error) throw error;
}

// -----------------------------------------------------------------
// Admin-only helpers — backed by SECURITY DEFINER RPCs in
// 013_admin_chat_meta.sql, each gated on user_roles.is_admin. Regular
// users calling these will get a 42501 from Postgres.
// -----------------------------------------------------------------

// Paginated read of one user's inbox. Matches the cursor semantics of
// the old RTDB query: pass `null` for the first page, then the
// timestamp of the oldest row from the previous page to get the next.
// Returns rows already flattened to the UI shape (via fromChatMetaRow).
export async function adminListUserChats(ownerUid, cursorMs = null, pageSize = 20) {
  if (!ownerUid) return [];
  const { data, error } = await supabase.rpc('admin_list_user_chats', {
    p_owner_uid: ownerUid,
    p_cursor_ms: cursorMs ?? null,
    p_limit: pageSize,
  });
  if (error) throw error;
  return (data || []).map(fromChatMetaRow);
}

// Symmetric two-sided delete used by the admin "Delete Conversation"
// tool. Removes both inbox rows; the RTDB /private_messages subtree is
// handled by the caller as before.
export async function adminDeleteChatPair(uid1, uid2) {
  if (!uid1 || !uid2) throw new Error('adminDeleteChatPair: both uids required');
  const { error } = await supabase.rpc('admin_delete_chat_pair', {
    p_uid1: uid1,
    p_uid2: uid2,
  });
  if (error) throw error;
}

// -----------------------------------------------------------------
// Realtime subscription
//
// Drop-in replacement for the onChildAdded/onChildChanged/onChildRemoved
// trio in ChatNavigator/InboxScreen. Behaviour:
//
//   1. Open the channel and subscribe to INSERT / UPDATE / DELETE filtered
//      by owner_uid=eq.<uid>.
//   2. Fire `onUpsert(row)` for every existing row from the initial load
//      (so callers populate their map exactly the way onChildAdded did),
//      then for every realtime INSERT/UPDATE.
//   3. Fire `onRemove(partnerId)` for every realtime DELETE.
//   4. Call `onReady()` once the initial load + first SUBSCRIBED status
//      have both landed, so the caller can flip its `loading` flag.
//
// Returns an unsubscribe function.
// -----------------------------------------------------------------
export function subscribeToChatMeta(ownerUid, { onUpsert, onRemove, onReady, onStatus } = {}) {
  if (!ownerUid) return () => {};

  let cancelled = false;
  let initialDone = false;
  let subscribedOnce = false;

  const tryReady = () => {
    if (initialDone && subscribedOnce && !cancelled) {
      onReady?.();
    }
  };

  // 1. Subscribe FIRST so we don't miss writes that land between the
  //    initial load and the channel SUBSCRIBED state.
  //
  // Topic is suffixed with a per-call random id because supabase-js
  // returns the *existing* channel if one with the same topic is
  // already registered. Two callers (ChatNavigator + InboxScreen) both
  // subscribe for the same uid, so without the suffix the second caller
  // gets a post-`subscribe()` channel and `.on('postgres_changes', …)`
  // throws "cannot add postgres_changes callbacks after subscribe()".
  const topic = `chat-meta:${ownerUid}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromChatMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromChatMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => {
        if (cancelled) return;
        const partnerId = payload.old?.partner_uid;
        if (partnerId) onRemove?.(partnerId);
      },
    )
    .subscribe((status, err) => {
      onStatus?.(status, err);
      if (status === 'SUBSCRIBED') {
        subscribedOnce = true;
        tryReady();
      }
    });

  // 2. Initial load runs in parallel with the subscribe handshake.
  loadChatMeta(ownerUid)
    .then((rows) => {
      if (cancelled) return;
      rows.forEach((r) => onUpsert?.(r));
      initialDone = true;
      tryReady();
    })
    .catch((e) => {
      console.warn('[chatMetaBackend] initial load failed:', e?.message);
      // Still mark loaded so the caller doesn't sit on a spinner forever.
      initialDone = true;
      tryReady();
    });

  return () => {
    cancelled = true;
    try { supabase.removeChannel(channel); } catch {}
  };
}

// -----------------------------------------------------------------
// Shared (ref-counted) chat-meta subscription.
//
// ChatNavigator (unread badge) and InboxScreen (chat list) both need the
// same owner_uid stream. Subscribing twice opened TWO realtime channels and
// every chat_meta_data change was delivered — and BILLED — twice. This
// multiplexes a single underlying subscribeToChatMeta to N in-process
// consumers and tears it down only when the last one detaches.
//
// Late joiners (e.g. InboxScreen mounting after ChatNavigator) are replayed
// the rows cached so far, plus the latest status / ready, so they see the
// same initial-load semantics as a direct subscription.
// -----------------------------------------------------------------
const _chatMetaShared = new Map(); // ownerUid -> entry

export function subscribeToChatMetaShared(ownerUid, handlers = {}) {
  if (!ownerUid) return () => {};

  let entry = _chatMetaShared.get(ownerUid);
  if (!entry) {
    entry = {
      listeners: new Set(),
      rows: new Map(),     // partnerId -> row (current snapshot)
      ready: false,
      lastStatus: null,
      unsubscribe: null,
    };
    _chatMetaShared.set(ownerUid, entry);

    entry.unsubscribe = subscribeToChatMeta(ownerUid, {
      onUpsert: (row) => {
        if (row?.partnerId) entry.rows.set(row.partnerId, row);
        entry.listeners.forEach((l) => l.onUpsert?.(row));
      },
      onRemove: (partnerId) => {
        entry.rows.delete(partnerId);
        entry.listeners.forEach((l) => l.onRemove?.(partnerId));
      },
      onReady: () => {
        entry.ready = true;
        entry.listeners.forEach((l) => l.onReady?.());
      },
      onStatus: (status, err) => {
        entry.lastStatus = status;
        entry.listeners.forEach((l) => l.onStatus?.(status, err));
      },
    });
  }

  entry.listeners.add(handlers);

  // Replay current state to the late joiner so it doesn't miss the load.
  if (entry.rows.size > 0) {
    entry.rows.forEach((row) => handlers.onUpsert?.(row));
  }
  if (entry.lastStatus) handlers.onStatus?.(entry.lastStatus);
  if (entry.ready) handlers.onReady?.();

  return () => {
    entry.listeners.delete(handlers);
    if (entry.listeners.size === 0) {
      try { entry.unsubscribe?.(); } catch {}
      _chatMetaShared.delete(ownerUid);
    }
  };
}
