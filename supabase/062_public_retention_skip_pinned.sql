-- 062: retention_public_messages skips pinned messages.
--
-- Found 2026-11-01 (Supabase health check, Ops/bugs/LOG.md 2026-11-01): the
-- 03:10 UTC cron job retention_public_messages (025) has failed every day since
-- 2026-09-03 with "violates foreign key constraint pinned_messages_message_id_fkey".
-- Each run is one statement, so one pinned message older than 3 days rolls the
-- whole delete back. Public chat was still trimmed by the older
-- cleanup-old-messages job (03:00 UTC, > 4 days, skips pinned).
--
-- Change: the same 3-day batched delete, minus messages that pinned_messages
-- still points at. Daily volume stays ~2-2.5K rows (the rows cleanup-old-messages
-- deletes today, one day sooner), so Realtime delete traffic does not grow.
-- The first run also removes the one day between 3 and 4 days old that
-- cleanup-old-messages left (dry run 2026-11-01: 6,585 rows older than 3 days,
-- 185 pinned kept); after that the daily volume is unchanged.
-- Grants: execute was open to authenticated (any signed-in user could call it
-- over PostgREST). Nothing in the app, functions or adoptme-web calls it; pg_cron
-- runs it as postgres, so it is revoked from public, anon and authenticated.
-- Rollback: re-run the function from 025_chat_retention.sql.

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
      select m.id from public.messages m
       where m.created_at < now() - interval '3 days'
         and not exists (select 1 from public.pinned_messages p where p.message_id = m.id)
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

revoke execute on function public.retention_public_messages() from public, anon, authenticated;
