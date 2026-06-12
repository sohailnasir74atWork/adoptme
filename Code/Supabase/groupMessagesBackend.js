// Group message body backend — Supabase-native.
//
// Replaces the RTDB /group_messages/{groupId}/messages/{key} subtree
// with a flat Postgres table. Idempotent sends via client_msg_id,
// soft-delete with audit trail, realtime INSERT/UPDATE/DELETE filtered
// by group_id.
//
// Schemas:
//   supabase/006_group_messages.sql       — table + RLS + is_group_member()
//   supabase/010_send_group_message.sql   — SECURITY DEFINER insert RPC
//   supabase/011_fanout_group_meta.sql    — bulk member fan-out RPC
//
// Notification CF: this module does NOT send pushes. A Supabase
// Database Webhook on INSERT of public.group_messages POSTs to the
// HTTPS notifyGroupMessage Cloud Function. See functions/notifyGroupMessage.js.
//
// API surface mirrors what GroupChatScreen.jsx already consumes
// (id + senderId + sender + avatar + text + imageUrl + imageUrls +
// fruits + replyTo + timestamp + isPro + robloxUsernameVerified +
// hasRecentGameWin + lastGameWinAt + isCreator).

import { supabase } from './client';
import { uuidv4 } from './uuid';

const PAGE_SIZE_DEFAULT = 25;

// Egress: only the columns fromGroupMessageRow maps. Skips updated_at /
// deleted_at / deleted_by on every paginated history fetch.
const GROUP_MSG_COLS =
  'id,client_msg_id,group_id,sender_id,sender_name,sender_avatar,text,image_url,' +
  'image_urls,fruits,reply_to,is_pro,roblox_username_verified,has_recent_game_win,' +
  'last_game_win_at,is_creator,os,deleted,report_count,reactions,created_at';

export function newClientMsgId() {
  return uuidv4();
}

// =====================================================================
// Row mapper
// =====================================================================
// DB columns (snake_case) → camelCase shape the UI consumes today.
// Field names match what GroupChatScreen.jsx wrote to RTDB so the
// existing message list renders without changes.
export function fromGroupMessageRow(row) {
  if (!row) return null;
  const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return {
    id: row.id,
    clientMsgId: row.client_msg_id ?? null,
    groupId: row.group_id,
    senderId: row.sender_id,
    sender: row.sender_name ?? null,
    avatar: row.sender_avatar ?? null,
    text: row.text ?? null,
    imageUrl: row.image_url ?? null,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : (row.image_urls ?? null),
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,
    isPro: !!row.is_pro,
    robloxUsernameVerified: !!row.roblox_username_verified,
    hasRecentGameWin: !!row.has_recent_game_win,
    lastGameWinAt: row.last_game_win_at ?? null,
    isCreator: !!row.is_creator,
    OS: row.os ?? null,
    deleted: !!row.deleted,
    reportCount: row.report_count ?? 0,
    // Map {userId: emoji} — same shape RTDB stored, so the renderer
    // (GroupMessageList / MessageActionDrawer) doesn't change.
    reactions: (row.reactions && typeof row.reactions === 'object') ? row.reactions : {},
    timestamp: ts,
    serverTime: ts,
  };
}

// =====================================================================
// Reads
// =====================================================================

// Initial / paginated load. `before` is a cursor: { createdAt, id }
// returned by the previous page's last row. Newest-first.
export async function loadGroupMessages(groupId, { limit = PAGE_SIZE_DEFAULT, before = null } = {}) {
  if (!groupId) return [];
  let q = supabase
    .from('group_messages')
    .select(GROUP_MSG_COLS)
    .eq('group_id', groupId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (before?.createdAt) {
    q = q.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[groupMessagesBackend] loadGroupMessages error:', error.message);
    return [];
  }
  return (data || []).map(fromGroupMessageRow);
}

// Forward pagination: messages strictly newer than `since`. Used for
// gap-fill on realtime reconnect. Returns newest-first.
export async function loadGroupMessagesSince(groupId, since = null, { limit = 200 } = {}) {
  if (!groupId) return [];
  let q = supabase
    .from('group_messages')
    .select(GROUP_MSG_COLS)
    .eq('group_id', groupId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (since?.createdAt) {
    q = q.or(
      `created_at.gt.${since.createdAt},and(created_at.eq.${since.createdAt},id.gt.${since.id})`,
    );
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[groupMessagesBackend] loadGroupMessagesSince error:', error.message);
    return [];
  }
  return (data || []).map(fromGroupMessageRow);
}

// =====================================================================
// Realtime
// =====================================================================

// Subscribe to INSERT / UPDATE / DELETE on a single group.
export function subscribeToGroupMessages(groupId, { onInsert, onUpdate, onDelete, onStatus } = {}) {
  if (!groupId) return () => {};

  const channel = supabase
    .channel(`group-messages:${groupId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => { onInsert?.(fromGroupMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => { onUpdate?.(fromGroupMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'group_messages', filter: `group_id=eq.${groupId}` },
      (payload) => { onDelete?.(payload.old?.id); },
    )
    .subscribe((status, err) => { onStatus?.(status, err); });

  return () => { try { supabase.removeChannel(channel); } catch {} };
}

// =====================================================================
// Writes
// =====================================================================

// Send a message via SECURITY DEFINER RPC (010_send_group_message.sql).
// Direct .insert() would hit `42501 RLS` for any member without a
// populated group_meta_data row (is_group_member() gate). The RPC
// self-validates and stamps sender_id from firebase_uid(). Idempotent:
// ON CONFLICT DO NOTHING + fallback select via UNIQUE(group_id,
// client_msg_id) so retries return the existing row.
export async function sendGroupMessage({
  groupId, senderId, message, clientMsgId = null,
}) {
  if (!groupId || !senderId || !message) {
    throw new Error('sendGroupMessage: groupId + senderId + message required');
  }

  const cmid = clientMsgId ?? newClientMsgId();

  const { data, error } = await supabase.rpc('send_group_message', {
    p_group_id: groupId,
    p_client_msg_id: cmid,
    p_text: message.text ?? null,
    p_image_url: message.imageUrl ?? null,
    p_image_urls: message.imageUrls ?? null,
    p_fruits: message.fruits ?? [],
    p_reply_to: message.replyTo ?? null,
    p_sender_name: message.sender ?? null,
    p_sender_avatar: message.avatar ?? null,
    p_is_pro: !!message.isPro,
    p_roblox_username_verified: !!message.robloxUsernameVerified,
    p_has_recent_game_win: !!message.hasRecentGameWin,
    p_last_game_win_at: message.lastGameWinAt ?? null,
    p_is_creator: !!message.isCreator,
    p_os: message.OS ?? null,
  });

  if (error) throw error;
  return fromGroupMessageRow(data);
}

// Bulk fan out the metadata bump to every group member via SECURITY
// DEFINER RPC (011_fanout_group_meta.sql). One atomic transaction:
// upserts last_message/sender info for every member, bumps unread_count
// for every non-sender. Replaces groupUtils.js multi-path RTDB update.
export async function fanoutGroupMessageMeta({
  groupId, memberIds, senderId,
  senderName = null, lastMessage = null,
  timestampMs = null, groupName = null,
}) {
  if (!groupId) throw new Error('fanoutGroupMessageMeta: groupId required');
  if (!Array.isArray(memberIds) || memberIds.length === 0) return;

  const { error } = await supabase.rpc('fanout_group_message_meta', {
    p_group_id: groupId,
    p_member_ids: memberIds,
    p_sender_id: senderId,
    p_sender_name: senderName,
    p_last_message: lastMessage,
    p_timestamp_ms: timestampMs ?? Date.now(),
    p_group_name: groupName,
  });
  if (error) throw error;
}

// Soft-delete a single message. Realtime UPDATE with deleted=true
// notifies all members; UI removes the row.
export async function softDeleteGroupMessage(messageId, deletedBy = null) {
  if (!messageId) return;
  const { error } = await supabase
    .from('group_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('id', messageId);
  if (error) throw error;
}

// Soft-delete the last N non-deleted messages from a sender in a group.
// Admin moderation flow.
export async function softDeleteGroupMessagesBySender(groupId, senderId, {
  limit = 60, deletedBy = null,
} = {}) {
  if (!groupId || !senderId) return { count: 0 };

  const { data, error: selectErr } = await supabase
    .from('group_messages')
    .select('id')
    .eq('group_id', groupId)
    .eq('sender_id', senderId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('group_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}

// Soft-delete every message in a group (admin "delete all" flow,
// usually paired with group-delete in Firestore).
export async function softDeleteAllInGroup(groupId, deletedBy = null) {
  if (!groupId) return { count: 0 };
  const { data, error: selectErr } = await supabase
    .from('group_messages')
    .select('id')
    .eq('group_id', groupId)
    .eq('deleted', false);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('group_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}

// Report a group message. Increments report_count; when the count
// crosses REPORT_THRESHOLD the message is soft-deleted and the caller
// escalates the ban.
const REPORT_THRESHOLD = 10;
export async function reportGroupMessage(messageId, reporterId = null) {
  if (!messageId) throw new Error('reportGroupMessage: messageId required');

  const { data: existing, error: selectErr } = await supabase
    .from('group_messages')
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) throw new Error('Message not found');

  const nextCount = (existing.report_count ?? 0) + 1;

  if (nextCount >= REPORT_THRESHOLD) {
    const { error } = await supabase
      .from('group_messages')
      .update({
        report_count: nextCount,
        deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: reporterId,
      })
      .eq('id', messageId);
    if (error) throw error;
    return { action: 'deleted' };
  }

  const { error } = await supabase
    .from('group_messages')
    .update({ report_count: nextCount })
    .eq('id', messageId);
  if (error) throw error;
  return { action: 'reported' };
}

// =====================================================================
// Reactions
// =====================================================================

// Atomic toggle of caller's reaction via SECURITY DEFINER RPC
// (012_group_message_reactions.sql). Mirrors RTDB tap-same-removes
// semantics. Pass emoji=null (or '') to clear. Returns the updated
// row so the caller can swap optimistic state to canonical without an
// extra select. The realtime UPDATE on group_messages broadcasts the
// row to every member, so cross-user reactions sync automatically.
export async function toggleGroupReaction(messageId, emoji = null) {
  if (!messageId) throw new Error('toggleGroupReaction: messageId required');

  const { data, error } = await supabase.rpc('toggle_group_reaction', {
    p_message_id: messageId,
    p_emoji: emoji ?? null,
  });
  if (error) throw error;
  return fromGroupMessageRow(data);
}
