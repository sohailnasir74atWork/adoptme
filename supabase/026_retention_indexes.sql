-- =====================================================================
-- 026_retention_indexes.sql — make 025's retention jobs actually runnable
-- =====================================================================
-- RUN THIS BEFORE THE 025 CRON JOBS FIRE (they are scheduled 03:10 / 04:20 /
-- 05:30 UTC). Without it, retention_private_messages will very likely fail or
-- crawl every night.
--
-- THE PROBLEM
-- -----------
-- 025's retention functions filter on `created_at` alone:
--
--     select id from public.private_messages
--      where created_at < now() - interval '20 days'
--      limit 5000
--
-- But every index on these tables is COMPOSITE with a different leading
-- column, so none of them can serve a bare created_at predicate:
--
--     idx_private_messages_chat_created   (chat_id, created_at desc, id desc)
--     idx_private_messages_chat_active    (chat_id, ...)
--     idx_private_messages_sender         (sender_id)
--     idx_private_messages_recipient      (recipient_id)
--     idx_messages_room_created           (room_id, created_at desc, id desc)
--     idx_group_messages_group_created    (group_id, created_at desc, id desc)
--
-- A leading-column index can't answer a predicate that doesn't mention that
-- column, so each batch does a SEQUENTIAL SCAN of the whole table.
--
-- Measured 2026-09-02 — private_messages holds 1,416,187 rows, and merely
-- COUNTING the rows older than 20 days over PostgREST returned:
--
--     {"code":"57014","message":"canceling statement due to statement timeout"}
--
-- If a single count times out, a loop doing ~200+ batched deletes (each
-- re-scanning 1.4M rows) is not going to finish.
--
-- Table sizes at the time of writing:
--     private_messages  1,416,187 rows
--     group_messages      213,864 rows  (oldest 2026-05-15)
--     messages             26,042 rows  (oldest 2026-04-26, 10,073 older than 3d)
--
-- ---------------------------------------------------------------------
-- HOW TO RUN
-- ---------------------------------------------------------------------
-- The Supabase SQL editor wraps EVERY statement in a transaction block, so
-- CREATE INDEX CONCURRENTLY cannot be used there at all -- not even alone:
--
--     ERROR: 25001: CREATE INDEX CONCURRENTLY cannot run inside a transaction block
--
-- So the statements below are plain CREATE INDEX. That takes an ACCESS
-- EXCLUSIVE lock on the table for the duration of the build, which BLOCKS
-- chat reads and writes while it runs. On a single-column btree over 1.4M
-- rows expect roughly 5-30 seconds. Run it at a quiet moment; chat clients
-- will retry.
--
-- Paste them ONE AT A TIME and let each finish.
--
-- If you would rather not lock the table at all, CONCURRENTLY works fine over
-- a direct psql connection (Dashboard -> Project Settings -> Database ->
-- Connection string), because psql does not wrap statements in a transaction:
--
--     psql "postgresql://postgres:[PASSWORD]@db.kvtbtzhtcaanhjblyick.supabase.co:5432/postgres" \
--       -c "create index concurrently if not exists idx_private_messages_created_at
--             on public.private_messages (created_at);"
--
-- Same for the other two. CONCURRENTLY is slower but never blocks writes.
-- =====================================================================


-- 1) The one that actually matters — run this first. ~1.4M rows.
create index if not exists idx_private_messages_created_at
  on public.private_messages (created_at);


-- 2) Same predicate, smaller table (~214k), but the seq scan grows with it.
create index if not exists idx_group_messages_created_at
  on public.group_messages (created_at);


-- 3) Small today (~26k), near-instant.
create index if not exists idx_messages_created_at
  on public.messages (created_at);



-- =====================================================================
-- AFTER THE INDEXES EXIST — clear the backlog manually, once
-- =====================================================================
-- The nightly jobs are sized for a day's worth of messages, not for the
-- multi-month backlog sitting there now. Draining ~1M+ rows inside one cron
-- run risks hitting the statement timeout mid-loop and bloating the table.
--
-- Do the first drain by hand, in chunks, watching each one. Repeat each
-- statement until it reports 0 rows affected:
--
--   delete from public.private_messages
--    where id in (select id from public.private_messages
--                  where created_at < now() - interval '20 days'
--                  limit 20000);
--
--   delete from public.messages
--    where id in (select id from public.messages
--                  where created_at < now() - interval '3 days'
--                  limit 20000);
--
-- group_messages is count-based (keep newest 300 per group), so its query
-- shape is different — the window function scans the table regardless. Run
-- retention_group_messages() directly once and time it:
--
--   select public.retention_group_messages();
--
-- Then reclaim the space (plain VACUUM, not FULL — FULL takes an exclusive
-- lock and rewrites the table):
--
--   vacuum analyze public.private_messages;
--   vacuum analyze public.group_messages;
--   vacuum analyze public.messages;
--
-- =====================================================================
-- VERIFY
-- =====================================================================
--   select indexname from pg_indexes
--    where tablename in ('private_messages','group_messages','messages')
--      and indexname like '%created_at%';
--
-- Confirm the planner now uses them:
--   explain (analyze, buffers)
--   select id from public.private_messages
--    where created_at < now() - interval '20 days' limit 5000;
--   -- want "Index Scan using idx_private_messages_created_at", not "Seq Scan"
--
-- Then check the jobs after their next run:
--   select j.jobname, r.status, r.return_message, r.start_time, r.end_time
--     from cron.job_run_details r join cron.job j using (jobid)
--    order by r.start_time desc limit 10;
