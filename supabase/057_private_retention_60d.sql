-- =====================================================================
-- 057_private_retention_60d.sql — keep private messages 60 days, not 20.
-- =====================================================================
-- Owner decision 2026-10-14: moderation disputes (review fights between
-- staff and users) kept arriving after the 20-day purge had already wiped
-- the conversation, so there was nothing to judge. 60 days gives staff a
-- realistic window.
--
-- Only the age changes. Same function name, signature, batching and the
-- existing 'retention_private_messages' pg_cron job (04:20 UTC daily) —
-- the job calls the function by name, so it is not rescheduled.
--
-- Messages already purged by the 20-day rule are gone; this only stops
-- anything currently between 20 and 60 days old from being deleted.
-- No client change: the app has no age filter of its own.
-- =====================================================================

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
       where created_at < now() - interval '60 days'
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
