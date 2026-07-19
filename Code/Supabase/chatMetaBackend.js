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
import { ensureRealtimeAuth } from './chatBackend';

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
// Incremental forward fetch — rows whose last-message timestamp is
// strictly newer than `sinceMs`. Used by the reconnect gap-fill (see
// subscribeToChatMeta) so chat_meta_data INSERT/UPDATE events missed
// while the realtime socket was down (client.js disconnects it after
// 20s in background; transient drops do the same) get backfilled with a
// TINY query — normally 0–few rows — instead of a full inbox reload.
// This is the cost-conscious counterpart to loadPrivateMessagesSince in
// privateMessagesBackend. No new index required: the same
// (owner_uid, timestamp_ms) ordering loadChatMeta relies on serves it.
// -----------------------------------------------------------------
export async function loadChatMetaSince(ownerUid, sinceMs = 0) {
  if (!ownerUid) return [];
  const { data, error } = await supabase
    .from('chat_meta_data')
    .select(CHAT_META_COLS)
    .eq('owner_uid', ownerUid)
    .gt('timestamp_ms', sinceMs || 0)
    .order('timestamp_ms', { ascending: false, nullsFirst: false })
    .limit(CHAT_META_PAGE);
  if (error) {
    console.warn('[chatMetaBackend] loadChatMetaSince error:', error.message);
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

// (subscribeToChatLastRead was removed: it opened a dedicated
// chat-lastread channel per open private chat, but useOtherLastRead in
// ChatScreen/utils.js reuses the shared chat-meta channel for the same
// signal, so the extra per-chat channel was dead code + a wasted
// realtime connection.)

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
  let prevStatus = null;      // last channel status seen (for reconnect detection)
  let maxKnownTs = 0;         // newest timestamp_ms delivered — the gap-fill cursor
  let gapFillInFlight = false;

  const tryReady = () => {
    if (initialDone && subscribedOnce && !cancelled) {
      onReady?.();
    }
  };

  // Central delivery so the reconnect gap-fill cursor (maxKnownTs) stays
  // accurate across BOTH the initial load and every realtime event.
  const deliver = (row) => {
    if (!row || cancelled) return;
    if (row.timestamp && row.timestamp > maxKnownTs) maxKnownTs = row.timestamp;
    onUpsert?.(row);
  };

  // Reconnect gap-fill. Supabase realtime does NOT replay events that
  // fired while the socket was down (client.js tears the socket down
  // after 20s in background; device sleep / network blips do the same),
  // so a private message that landed during the gap would otherwise stay
  // invisible in the inbox + unread badge until an app restart re-ran
  // loadChatMeta. On every reconnect we fetch ONLY the rows newer than
  // the newest we've already seen — usually 0–few rows — so this adds
  // negligible egress and ZERO realtime cost. Mirrors the gap-fill the
  // public + private chat bodies already do.
  const runGapFill = () => {
    if (cancelled || gapFillInFlight) return;
    gapFillInFlight = true;
    loadChatMetaSince(ownerUid, maxKnownTs)
      .then((rows) => { if (!cancelled) rows.forEach(deliver); })
      .catch((e) => console.warn('[chatMetaBackend] gap-fill failed:', e?.message))
      .finally(() => { gapFillInFlight = false; });
  };

  // Attach handlers FIRST so nothing is lost between JOIN and bind; the
  // initial loadChatMeta covers the pre-subscribe window.
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
      (payload) => deliver(fromChatMetaRow(payload.new)),
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_meta_data',
        filter: `owner_uid=eq.${ownerUid}`,
      },
      (payload) => deliver(fromChatMetaRow(payload.new)),
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
    );

  const onSubscribeStatus = (status, err) => {
    onStatus?.(status, err);
    if (status === 'SUBSCRIBED') {
      // A SUBSCRIBED that follows a non-SUBSCRIBED status is a RECONNECT
      // (CLOSED/CHANNEL_ERROR/TIMED_OUT → SUBSCRIBED) — backfill whatever
      // the socket missed while it was down. The very first subscribe is
      // already covered by the initial loadChatMeta below, so skip it.
      if (prevStatus && prevStatus !== 'SUBSCRIBED') runGapFill();
      subscribedOnce = true;
      tryReady();
    }
    prevStatus = status;
  };

  // Refresh the realtime JWT before joining so a stale token on a
  // long-lived socket can't silently drop our RLS-filtered
  // postgres_changes (the public/private chat backends already do this;
  // the chat-meta channel previously did not, so its events could quietly
  // stop arriving after the Firebase token aged out). Handlers are bound
  // above BEFORE subscribe, so deferring the subscribe by one async tick
  // loses nothing.
  ensureRealtimeAuth().finally(() => {
    if (cancelled) return;
    channel.subscribe(onSubscribeStatus);
  });

  // Initial load runs in parallel with the auth + subscribe handshake.
  loadChatMeta(ownerUid)
    .then((rows) => {
      if (cancelled) return;
      rows.forEach(deliver);
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
      maxTs: 0,            // newest timestamp_ms seen (cursor for manual refresh)
      ready: false,
      lastStatus: null,
      unsubscribe: null,
    };
    _chatMetaShared.set(ownerUid, entry);

    entry.unsubscribe = subscribeToChatMeta(ownerUid, {
      onUpsert: (row) => {
        if (row?.partnerId) entry.rows.set(row.partnerId, row);
        if (row?.timestamp && row.timestamp > entry.maxTs) entry.maxTs = row.timestamp;
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

// -----------------------------------------------------------------
// Manual full resync — the pull-to-refresh escape hatch.
//
// Realtime + the reconnect gap-fill are the steady-state paths; this is
// the user-initiated recovery for the rare case where the socket stayed
// up but silently missed an event (e.g. a stale token that never tripped
// a status change). Because it's rare and only fires on an explicit pull,
// it does a FULL loadChatMeta so it also reconciles deletions / unread /
// mute changes an incremental gap-fill wouldn't catch. Results are fanned
// through the shared entry, so ONE fetch updates both the inbox list and
// the unread badge. No-op if no consumer is subscribed for this uid.
// -----------------------------------------------------------------
export async function refreshChatMetaShared(ownerUid) {
  if (!ownerUid) return;
  const entry = _chatMetaShared.get(ownerUid);
  if (!entry) return;

  const rows = await loadChatMeta(ownerUid);
  const fresh = new Map();
  for (const row of rows) {
    if (!row?.partnerId) continue;
    fresh.set(row.partnerId, row);
    if (row.timestamp && row.timestamp > entry.maxTs) entry.maxTs = row.timestamp;
  }

  // Upsert everything from the fresh snapshot.
  fresh.forEach((row, partnerId) => {
    entry.rows.set(partnerId, row);
    entry.listeners.forEach((l) => l.onUpsert?.(row));
  });

  // Drop rows that no longer exist server-side (deleted while we were
  // offline) so the list doesn't keep phantom chats after a refresh.
  for (const partnerId of Array.from(entry.rows.keys())) {
    if (!fresh.has(partnerId)) {
      entry.rows.delete(partnerId);
      entry.listeners.forEach((l) => l.onRemove?.(partnerId));
    }
  }
}
