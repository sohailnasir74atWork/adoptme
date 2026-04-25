-- =====================================================================
-- Migration: idempotent message sends + gap-fill pagination support
-- =====================================================================
-- Adds `client_msg_id`: a client-generated UUID that lets the client
-- retry sends safely without creating duplicate rows on flaky networks.
--
-- Paired with optimistic UI + an in-memory retry queue in Trader.jsx:
--   • client generates a UUID per send
--   • server UNIQUE(room_id, client_msg_id) guarantees one row per send
--   • retries or page-reloads that resend the same UUID are no-ops
--
-- Safe to run on a populated `messages` table: existing rows get NULL.
-- The unique constraint allows multiple NULLs (Postgres default), so
-- pre-migration rows are unaffected.
-- =====================================================================

alter table public.messages
  add column if not exists client_msg_id uuid;

-- Unique within a room. NULLs are permitted and do not collide, so the
-- constraint kicks in only once the client starts sending the column.
create unique index if not exists idx_messages_room_client_msg_id
  on public.messages (room_id, client_msg_id)
  where client_msg_id is not null;

-- RLS: allow the column through INSERT checks (our existing policy is
-- `sender_id = firebase_uid()` with no column list restriction, so no
-- policy change needed — documenting the intent here).
