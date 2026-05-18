-- =====================================================================
-- 015_seed_missing_rooms.sql
-- Seeds the Italian (it) and Armenian (hy) public chat rooms that were
-- added to the CHANNELS array in Trader.jsx after schema.sql was written.
-- Without these rows, roomIdFromRtdbPath() returns null for chat_it /
-- chat_hy and the client bails with "No roomId for current channel"
-- when anyone tries to send in those channels.
-- =====================================================================

insert into public.rooms (id, room_type, language, name) values
  ('public:it', 'public', 'it', 'Italiano'),
  ('public:hy', 'public', 'hy', 'Հայերեն')
on conflict (id) do nothing;
