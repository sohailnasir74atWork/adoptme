-- =====================================================================
-- 027 — Supabase hygiene for adoptme (kvtbtzhtcaanhjblyick), 2026-09-04
--
-- Measured: supabase_functions.hooks = 3,320,548 rows / 458 MB (every
-- webhook call since 2026-05-13, never purged); net._http_response = 1 GB
-- for 5,841 live rows (dead space). Neither is read by anything after a
-- few days. These statements were NOT run automatically (bulk delete /
-- vacuum are destructive-class operations) — paste into the SQL Editor
-- off-peak, one block at a time.
-- =====================================================================

-- 1) Nightly purge (same job blox_fruit already has). Idempotent.
select cron.schedule(
  'purge-webhook-hooks',
  '17 4 * * *',
  $$delete from supabase_functions.hooks where created_at < now() - interval '3 days'$$
)
where not exists (select 1 from cron.job where jobname = 'purge-webhook-hooks');

-- 2) Initial purge in batches (re-run this block until it deletes 0 rows;
--    each batch is ~150k rows and finishes in a few seconds on a Micro).
with d as (
  select id from supabase_functions.hooks
  where created_at < now() - interval '3 days'
  order by id limit 150000
)
delete from supabase_functions.hooks h using d where h.id = d.id;

-- 3) Reclaim the dead space (brief exclusive lock on each table; run when
--    traffic is low). VACUUM cannot run inside the SQL Editor's transaction —
--    use the Management API query endpoint or psql.
-- vacuum full net._http_response;
-- vacuum full supabase_functions.hooks;

-- 4) Optional, online: rebuild the bloated private_messages indexes
--    (766 MB of indexes on 1.4 M rows). One at a time, via the Management API.
-- select indexrelname, pg_size_pretty(pg_relation_size(indexrelid))
--   from pg_stat_user_indexes where relname = 'private_messages' order by 2 desc;
-- reindex index concurrently public.<index_name>;
