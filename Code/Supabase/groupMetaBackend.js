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

export async function loadGroupMeta(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('group_meta_data')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    console.warn('[groupMetaBackend] loadGroupMeta error:', error.message);
    return [];
  }
  return (data || []).map(fromGroupMetaRow);
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
