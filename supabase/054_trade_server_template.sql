-- =====================================================================
-- 054 — "Trade in game" invite template (adoptme), 2026-10-08
--
-- Player request: a button in private chat that takes both players into
-- Adopt Me to finish the trade. The app sends a vetted template
-- (`trade_server`, Code/ChatScreen/safeTemplates.js); the chat's pinned
-- "Trade in game" line has a Join chip that opens the admin's
-- private-server link (RTDB /server). No link is ever stored in a message.
--
-- Ordinary chats accept any template id already. This row is only needed
-- so safe chat (a player under 13 on either side) accepts it too: the
-- enforce_safe_chat() trigger rejects any template it can't find here.
-- 028's seed block is regenerated to match (node scripts/gen-safe-templates-sql.js).
--
-- A one-row upsert: it never locks private_messages, so it is safe to run
-- on the live database (unlike 028's table changes). Idempotent.
-- =====================================================================

insert into public.safe_chat_templates (id, text_en, category) values
  ('trade_server', 'Let''s trade in game! Join me in the Trading Zone server.', 'trade')
on conflict (id) do update
  set text_en  = excluded.text_en,
      category = excluded.category;
