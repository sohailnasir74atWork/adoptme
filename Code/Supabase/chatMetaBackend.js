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
  };
}

// -----------------------------------------------------------------
// Initial load — Supabase realtime doesn't replay history, so the
// caller fetches once on attach and then keeps state in sync via the
// realtime channel.
// -----------------------------------------------------------------
export async function loadChatMeta(ownerUid) {
  if (!ownerUid) return [];
  const { data, error } = await supabase
    .from('chat_meta_data')
    .select('*')
    .eq('owner_uid', ownerUid);
  if (error) {
    console.warn('[chatMetaBackend] loadChatMeta error:', error.message);
    return [];
  }
  return (data || []).map(fromChatMetaRow);
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
