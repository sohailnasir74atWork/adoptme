// Group-list metadata backend — Supabase mirror of RTDB /group_meta_data.
//
// Sister of chatMetaBackend.js — same shape, different table. Writes
// (group create / accept invite / mute toggle / sendGroupMessage's
// per-member fan-out) stay on RTDB so notifyGroupMessage and the
// /activeGroupChats presence flow keep working unchanged. The
// mirrorGroupMetaToSupabase Cloud Function tails those RTDB writes and
// upserts the row here.
//
// The flat row shape exposed to the UI mirrors what ChatNavigator's
// `parseGroupData` already consumes:
//   { groupId, groupName, groupAvatar, lastMessage, lastMessageTimestamp,
//     unreadCount, memberCount, createdBy, muted,
//     lastMessageSenderId, lastMessageSenderName }

import { supabase } from './client';

export function fromGroupMetaRow(row) {
  if (!row) return null;
  return {
    groupId: row.group_id,
    groupName: row.group_name ?? null,
    groupAvatar: row.group_avatar ?? null,
    lastMessage: row.last_message ?? null,
    lastMessageTimestamp: row.last_message_timestamp_ms ?? 0,
    lastMessageSenderId: row.last_message_sender_id ?? null,
    lastMessageSenderName: row.last_message_sender_name ?? null,
    memberCount: row.member_count ?? 0,
    createdBy: row.created_by ?? null,
    unreadCount: row.unread_count ?? 0,
    muted: !!row.muted,
    joinedAt: row.joined_at_ms ?? null,
    lastReadAt: row.last_read_at_ms ?? null,
  };
}

// Reset group unread count directly in Supabase — mirrors resetUnreadCount()
// in chatMetaBackend.js. Called when user opens a group so the badge clears
// instantly without waiting for the mirror CF.
export async function resetGroupUnreadCount(userId, groupId) {
  if (!userId || !groupId) return;
  await supabase
    .from('group_meta_data')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('group_id', groupId);
  // Errors intentionally swallowed — RTDB + mirror CF is the fallback.
}

// Paginated via .range() because Supabase enforces a server-side
// max_rows cap (default 1000) that .limit(N) doesn't override. Same
// silent-truncation class as loadChatMeta — see that fn for context.
const GROUP_META_PAGE = 1000;

export async function loadGroupMeta(userId) {
  if (!userId) return [];
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('group_meta_data')
      .select('*')
      .eq('user_id', userId)
      .order('last_message_timestamp_ms', { ascending: false, nullsFirst: false })
      .range(from, from + GROUP_META_PAGE - 1);
    if (error) {
      console.warn('[groupMetaBackend] loadGroupMeta error:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const row of data) out.push(fromGroupMetaRow(row));
    if (data.length < GROUP_META_PAGE) break;
    from += GROUP_META_PAGE;
  }
  return out;
}

// Drop-in replacement for the group_meta_data onChildAdded/Changed/Removed
// listener in ChatNavigator. Same contract as subscribeToChatMeta:
//   * onUpsert fires once per existing row (initial load) then per
//     INSERT/UPDATE.
//   * onRemove fires per DELETE (when a user leaves a group, or
//     cleanupGroups removes the row).
//   * onReady fires once initial load + first SUBSCRIBED both land.
export function subscribeToGroupMeta(userId, { onUpsert, onRemove, onReady, onStatus } = {}) {
  if (!userId) return () => {};

  let cancelled = false;
  let initialDone = false;
  let subscribedOnce = false;

  const tryReady = () => {
    if (initialDone && subscribedOnce && !cancelled) {
      onReady?.();
    }
  };

  // Per-call random suffix on the topic — supabase-js returns the
  // existing channel for a duplicate topic, which makes a second
  // subscriber land on an already-`subscribe()`d channel and any
  // `.on('postgres_changes', …)` chained onto it throws.
  const topic = `group-meta:${userId}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(topic)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'group_meta_data',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromGroupMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'group_meta_data',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => { if (!cancelled) onUpsert?.(fromGroupMetaRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'group_meta_data',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (cancelled) return;
        const groupId = payload.old?.group_id;
        if (groupId) onRemove?.(groupId);
      },
    )
    .subscribe((status, err) => {
      onStatus?.(status, err);
      if (status === 'SUBSCRIBED') {
        subscribedOnce = true;
        tryReady();
      }
    });

  loadGroupMeta(userId)
    .then((rows) => {
      if (cancelled) return;
      rows.forEach((r) => onUpsert?.(r));
      initialDone = true;
      tryReady();
    })
    .catch((e) => {
      console.warn('[groupMetaBackend] initial load failed:', e?.message);
      initialDone = true;
      tryReady();
    });

  return () => {
    cancelled = true;
    try { supabase.removeChannel(channel); } catch {}
  };
}

// -----------------------------------------------------------------
// Shared (ref-counted) group-meta subscription. Sister of
// subscribeToChatMetaShared — see that fn for rationale. Collapses the
// duplicate group_meta_data channels into one underlying subscription and
// replays cached rows / status to late-joining consumers.
// -----------------------------------------------------------------
const _groupMetaShared = new Map(); // userId -> entry

export function subscribeToGroupMetaShared(userId, handlers = {}) {
  if (!userId) return () => {};

  let entry = _groupMetaShared.get(userId);
  if (!entry) {
    entry = {
      listeners: new Set(),
      rows: new Map(),     // groupId -> row
      ready: false,
      lastStatus: null,
      unsubscribe: null,
    };
    _groupMetaShared.set(userId, entry);

    entry.unsubscribe = subscribeToGroupMeta(userId, {
      onUpsert: (row) => {
        if (row?.groupId) entry.rows.set(row.groupId, row);
        entry.listeners.forEach((l) => l.onUpsert?.(row));
      },
      onRemove: (groupId) => {
        entry.rows.delete(groupId);
        entry.listeners.forEach((l) => l.onRemove?.(groupId));
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

  if (entry.rows.size > 0) {
    entry.rows.forEach((row) => handlers.onUpsert?.(row));
  }
  if (entry.lastStatus) handlers.onStatus?.(entry.lastStatus);
  if (entry.ready) handlers.onReady?.();

  return () => {
    entry.listeners.delete(handlers);
    if (entry.listeners.size === 0) {
      try { entry.unsubscribe?.(); } catch {}
      _groupMetaShared.delete(userId);
    }
  };
}
