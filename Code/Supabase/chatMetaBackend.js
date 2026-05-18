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
