// Private (1-on-1) message body backend — Supabase-native.
//
// Replaces the RTDB /private_messages/{chatId}/messages/{key} subtree
// with a flat Postgres table. Same shape as public chat: idempotent
// sends via client_msg_id, soft-delete with audit trail, realtime
// INSERT/UPDATE/DELETE stream filtered by chat_id.
//
// Schema: supabase/005_private_messages.sql
// Meta RPC: supabase/009_send_private_chat_meta.sql
//
// Notification CF: this module does NOT send pushes. A Supabase
// Database Webhook on INSERT of public.private_messages POSTs to the
// HTTPS notifyNewMessage Cloud Function. See functions/notifyNewMessage.js.
//
// API surface mirrors what PrivateChat.jsx already consumes (id +
// senderId + text + imageUrl + imageUrls + fruits + replyTo + timestamp),
// so the screen swap is a transport change, not a render rewrite.

import { supabase } from './client';
import { uuidv4 } from './uuid';

const PAGE_SIZE_DEFAULT = 15;

// Egress: only the columns fromPrivateMessageRow maps. Skips updated_at /
// deleted_at / deleted_by on every paginated history fetch.
const PRIVATE_MSG_COLS =
  'id,client_msg_id,chat_id,sender_id,recipient_id,text,image_url,image_urls,' +
  'fruits,reply_to,os,deleted,report_count,created_at';

// Canonical chat id used by both RTDB and the Supabase chat_id column.
// Sort the two UIDs alphabetically and join with an underscore.
export function chatIdForPair(uidA, uidB) {
  return [uidA, uidB].sort().join('_');
}

export function newClientMsgId() {
  return uuidv4();
}

// =====================================================================
// Row mapper
// =====================================================================
// DB columns → camelCase shape PrivateChat.jsx + PrivateMessageList render.
// Field names match the existing RTDB shape so there is no UI rewrite.
export function fromPrivateMessageRow(row) {
  if (!row) return null;
  const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
  return {
    id: row.id,                                  // uuid — React key + cursor
    clientMsgId: row.client_msg_id ?? null,
    chatId: row.chat_id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    text: row.text ?? null,
    imageUrl: row.image_url ?? null,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : (row.image_urls ?? null),
    fruits: Array.isArray(row.fruits) ? row.fruits : [],
    replyTo: row.reply_to ?? null,
    OS: row.os ?? null,
    deleted: !!row.deleted,
    reportCount: row.report_count ?? 0,
    timestamp: ts,                               // ms epoch — UI sort key
    serverTime: ts,                              // mirrors RTDB serverTime
  };
}

function toInsertPayload({
  chatId, clientMsgId, senderId, recipientId,
  text, imageUrl, imageUrls, fruits, replyTo, OS,
}) {
  return {
    chat_id: chatId,
    client_msg_id: clientMsgId ?? null,
    sender_id: senderId,
    recipient_id: recipientId,
    text: text ?? null,
    image_url: imageUrl ?? null,
    image_urls: imageUrls ?? null,
    fruits: fruits ?? [],
    reply_to: replyTo ?? null,
    os: OS ?? null,
  };
}

// =====================================================================
// Reads
// =====================================================================

// Initial / paginated load. `before` is a cursor: { createdAt: ISO, id }
// returned by the previous page's last row. Newest-first within a chat.
export async function loadPrivateMessages(chatId, { limit = PAGE_SIZE_DEFAULT, before = null } = {}) {
  if (!chatId) return [];
  let q = supabase
    .from('private_messages')
    .select(PRIVATE_MSG_COLS)
    .eq('chat_id', chatId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (before?.createdAt) {
    // Composite cursor — Postgres evaluates this as a row comparison;
    // the (chat_id, created_at desc, id desc) index serves it.
    q = q.or(
      `created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;
  if (error) {
    console.warn('[privateMessagesBackend] loadPrivateMessages error:', error.message);
    return [];
  }
  return (data || []).map(fromPrivateMessageRow);
}

// Forward pagination: messages strictly newer than `since`. Used for
// gap-fill on reconnect so events missed while the WebSocket was dead
// are backfilled. Returns newest-first to match render order.
export async function loadPrivateMessagesSince(chatId, since = null, { limit = 200 } = {}) {
  if (!chatId) return [];
  let q = supabase
    .from('private_messages')
    .select(PRIVATE_MSG_COLS)
    .eq('chat_id', chatId)
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
    console.warn('[privateMessagesBackend] loadPrivateMessagesSince error:', error.message);
    return [];
  }
  return (data || []).map(fromPrivateMessageRow);
}

// =====================================================================
// Realtime
// =====================================================================

// Subscribe to INSERT / UPDATE / DELETE on a single chat.
//
// onInsert(msg) fires for new messages (own + partner's).
// onUpdate(msg) fires for soft-delete + any edit. UI usually treats
//   msg.deleted === true as a removal.
// onDelete(id) fires for hard delete (rare, mod path).
//
// Returns an unsubscribe function.
export function subscribeToPrivateMessages(chatId, { onInsert, onUpdate, onDelete, onStatus } = {}) {
  if (!chatId) return () => {};

  const channel = supabase
    .channel(`pvt-messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chatId}` },
      (payload) => { onInsert?.(fromPrivateMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chatId}` },
      (payload) => { onUpdate?.(fromPrivateMessageRow(payload.new)); },
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chatId}` },
      (payload) => { onDelete?.(payload.old?.id); },
    )
    .subscribe((status, err) => { onStatus?.(status, err); });

  return () => { try { supabase.removeChannel(channel); } catch {} };
}

// =====================================================================
// Writes
// =====================================================================

// Send a message. Idempotent across retries via UNIQUE(chat_id,
// client_msg_id). Returns the row in the UI shape so callers can
// optimistic-update + reconcile on resolve.
export async function sendPrivateMessage({
  chatId, senderId, recipientId,
  text = null, imageUrl = null, imageUrls = null,
  fruits = [], replyTo = null,
  OS = null, clientMsgId = null,
}) {
  if (!chatId || !senderId || !recipientId) {
    throw new Error('sendPrivateMessage: chatId + senderId + recipientId required');
  }

  const payload = toInsertPayload({
    chatId,
    clientMsgId: clientMsgId ?? newClientMsgId(),
    senderId,
    recipientId,
    text,
    imageUrl,
    imageUrls,
    fruits,
    replyTo,
    OS,
  });

  const { data, error } = await supabase
    .from('private_messages')
    .insert(payload)
    .select()
    .single();

  if (error) {
    // Idempotency: a previous retry already landed → fetch + return it
    // so the caller can swap their optimistic placeholder cleanly.
    if (error.code === '23505' && payload.client_msg_id) {
      const { data: existing, error: selectErr } = await supabase
        .from('private_messages')
        .select('*')
        .eq('chat_id', chatId)
        .eq('client_msg_id', payload.client_msg_id)
        .maybeSingle();
      if (selectErr) throw selectErr;
      if (existing) return fromPrivateMessageRow(existing);
    }
    throw error;
  }
  return fromPrivateMessageRow(data);
}

// Atomic two-sided chat-meta upsert via SECURITY DEFINER RPC.
// Replaces the multi-path RTDB update PrivateChat.jsx does today
// (sender row + receiver row + unread_count increment). RPC determines
// the caller's UID from the JWT, computes the canonical pair_id, and
// preserves muted on existing rows.
export async function sendPrivateChatMeta({
  partnerUid, lastMessage, timestampMs,
  senderName = null, senderAvatar = null,
  receiverName = null, receiverAvatar = null,
}) {
  if (!partnerUid) throw new Error('sendPrivateChatMeta: partnerUid required');

  const { error } = await supabase.rpc('send_private_chat_meta', {
    p_partner_uid:     partnerUid,
    p_last_message:    lastMessage ?? '',
    p_timestamp_ms:    timestampMs ?? Date.now(),
    p_sender_name:     senderName,
    p_sender_avatar:   senderAvatar,
    p_receiver_name:   receiverName,
    p_receiver_avatar: receiverAvatar,
  });
  if (error) throw error;
}

// Soft-delete a single message. UI filters deleted rows out via
// loadPrivateMessages and subscribeToPrivateMessages.onUpdate.
export async function softDeletePrivateMessage(messageId, deletedBy = null) {
  if (!messageId) return;
  const { error } = await supabase
    .from('private_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .eq('id', messageId);
  if (error) throw error;
}

// Report a private message. Increments report_count; when the count
// crosses REPORT_THRESHOLD the message is soft-deleted and the caller
// escalates the ban. Returns { action } so callers can branch UI.
const REPORT_THRESHOLD = 10;
export async function reportPrivateMessage(messageId, reporterId = null) {
  if (!messageId) throw new Error('reportPrivateMessage: messageId required');

  const { data: existing, error: selectErr } = await supabase
    .from('private_messages')
    .select('report_count')
    .eq('id', messageId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (!existing) throw new Error('Message not found');

  const nextCount = (existing.report_count ?? 0) + 1;

  if (nextCount >= REPORT_THRESHOLD) {
    const { error } = await supabase
      .from('private_messages')
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
    .from('private_messages')
    .update({ report_count: nextCount })
    .eq('id', messageId);
  if (error) throw error;
  return { action: 'reported' };
}

// Soft-delete every non-deleted message in a chat. PostgREST doesn't
// expose UPDATE..ORDER BY..LIMIT so this is two round-trips.
export async function softDeleteAllInChat(chatId, deletedBy = null) {
  if (!chatId) return { count: 0 };
  const { data, error: selectErr } = await supabase
    .from('private_messages')
    .select('id')
    .eq('chat_id', chatId)
    .eq('deleted', false);
  if (selectErr) throw selectErr;
  if (!data?.length) return { count: 0 };

  const ids = data.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('private_messages')
    .update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: deletedBy,
    })
    .in('id', ids);
  if (updateErr) throw updateErr;
  return { count: ids.length };
}
