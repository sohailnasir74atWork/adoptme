-- =====================================================================
-- 025_chat_retention.sql — retention for the Supabase chat tables
--
-- WHY (COST_OPTIMIZATION_2026-09.md F5)
-- -------------------------------------
-- RTDB retention is enforced by three scheduled Cloud Functions:
--
--   cleanupOldPublicChats     public chat   → 3 days
--   cleanupOldPrivateChats    private chat  → 20 days
--   cleanupGroupChatMessages  group chat    → keep last 300 per group
--
-- None of them touch Supabase, and there was no pg_cron job or retention
-- clause anywhere in migrations 002-024. Live chat moved to Supabase, so
-- these tables have been growing without bound since the migration:
--
--   notifyNewMessage    54,379 / 7d  ≈  7,800 private msgs/day
--   notifyGroupMessage  15,684 / 7d  ≈  2,240 group   msgs/day
--                                    ≈  3.6M rows/year
--
-- This migration mirrors the RTDB policy exactly, so the two stores age out
-- together and nothing that is visible in one silently outlives the other.
--
-- IDEMPOTENT — safe to re-run. Schedules are replaced, not duplicated.
--
-- ---------------------------------------------------------------------
-- BEFORE YOU RUN THIS
-- ---------------------------------------------------------------------
-- 1. This DELETES DATA. Check what it would remove first:
--
--      select 'messages' t, count(*) from public.messages
--        where created_at < now() - interval '3 days'
--      union all
--      select 'private_messages', count(*) from public.private_messages
--        where created_at < now() - interval '20 days';
--
-- 2. If those counts are large, the first run will be a big delete. Consider
--    running the bodies manually in batches once before enabling the cron.
--
-- 3. pg_cron must be enabled: Dashboard → Database → Extensions → pg_cron.
--    The create extension below handles it if you have the privilege.
-- =====================================================================

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- 1. Public room messages — 3 days (matches cleanupOldPublicChats)
-- ---------------------------------------------------------------------
create or replace function public.retention_public_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  -- Batched so a large backlog can't hold one long transaction open.
  loop
    with doomed as (
      select id from public.messages
       where created_at < now() - interval '3 days'
       limit 5000
    )
    delete from public.messages m
     using doomed d
     where m.id = d.id;

    get diagnostics removed = row_count;
    exit when removed = 0;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Private messages — 20 days (matches cleanupOldPrivateChats)
-- ---------------------------------------------------------------------
create or replace function public.retention_private_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  loop
    with doomed as (
      select id from public.private_messages
       where created_at < now() - interval '20 days'
       limit 5000
    )
    delete from public.private_messages p
     using doomed d
     where p.id = d.id;

    get diagnostics removed = row_count;
    exit when removed = 0;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Group messages — keep the newest 300 per group
--    (matches cleanupGroupChatMessages KEEP_LAST = 300)
--
-- Count-based rather than age-based on purpose: a quiet group keeps its
-- whole history, exactly like the RTDB job.
-- ---------------------------------------------------------------------
create or replace function public.retention_group_messages()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.group_messages gm
   using (
     select id
       from (
         select id,
                row_number() over (
                  partition by group_id
                  order by created_at desc, id desc
                ) as rn
           from public.group_messages
       ) ranked
      where ranked.rn > 300
   ) doomed
   where gm.id = doomed.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Schedule — staggered, in the same 03:00-05:00 UTC window the RTDB
--    jobs already use so all retention happens during the traffic trough.
-- ---------------------------------------------------------------------
select cron.unschedule(jobid)
  from cron.job
 where jobname in (
   'retention_public_messages',
   'retention_private_messages',
   'retention_group_messages'
 );

select cron.schedule(
  'retention_public_messages', '10 3 * * *',
  $$select public.retention_public_messages();$$
);

select cron.schedule(
  'retention_private_messages', '20 4 * * *',
  $$select public.retention_private_messages();$$
);

select cron.schedule(
  'retention_group_messages', '30 5 * * *',
  $$select public.retention_group_messages();$$
);

-- ---------------------------------------------------------------------
-- 5. Verify
-- ---------------------------------------------------------------------
-- Scheduled jobs:
--   select jobid, jobname, schedule, active from cron.job order by jobname;
--
-- Run history (check after the first night):
--   select j.jobname, r.status, r.return_message, r.start_time, r.end_time
--     from cron.job_run_details r
--     join cron.job j using (jobid)
--    order by r.start_time desc
--    limit 20;
--
-- Table sizes, before and after:
--   select relname,
--          pg_size_pretty(pg_total_relation_size(relid)) as total,
--          n_live_tup
--     from pg_stat_user_tables
--    where relname in ('messages','private_messages','group_messages')
--    order by pg_total_relation_size(relid) desc;
