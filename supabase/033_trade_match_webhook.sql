-- =====================================================================
-- 033 — Trade Match webhook (adoptme, kvtbtzhtcaanhjblyick), 2026-09-29
--
-- Same thing the Dashboard "Database Webhooks" page creates: an AFTER INSERT
-- trigger on trade_match_alerts calling supabase_functions.http_request.
--
-- The x-webhook-secret header is COPIED from the existing Cloud Function
-- webhook (notifyNewMessage / notifyGroupMessage), so the secret never
-- appears in this file or on screen. Run after 032. Idempotent.
-- =====================================================================

do $$
declare
  v_headers text;
  v_src     text;
begin
  select a[3], c.relname || '.' || t.tgname
    into v_headers, v_src
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  cross join lateral (
    select string_to_array(encode(t.tgargs, 'escape'), '\000') as a
  ) args
  where t.tgfoid = 'supabase_functions.http_request'::regproc
    and a[1] like 'https://us-central1-adoptme-7b50c.cloudfunctions.net/%'
    and a[3] like '%x-webhook-secret%'
  order by (a[1] like '%notifyNewMessage%') desc
  limit 1;

  if v_headers is null then
    raise exception '033: no existing Cloud Function webhook with x-webhook-secret found to copy headers from';
  end if;

  execute 'drop trigger if exists notify_trade_match on public.trade_match_alerts';
  execute format(
    'create trigger notify_trade_match after insert on public.trade_match_alerts '
    'for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    'https://us-central1-adoptme-7b50c.cloudfunctions.net/notifyTradeMatch',
    'POST',
    replace(v_headers, '\\', '\'),
    '{}',
    '5000'
  );
  raise notice '033: notify_trade_match created (headers copied from %)', v_src;
end
$$;

-- Check (shows URLs only, never headers):
select c.relname as table_name, t.tgname as trigger_name,
       split_part(encode(t.tgargs, 'escape'), '\000', 1) as url
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where t.tgfoid = 'supabase_functions.http_request'::regproc
order by 1, 2;
