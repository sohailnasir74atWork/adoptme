-- =====================================================================
-- 035 — Squad webhook (adoptme, kvtbtzhtcaanhjblyick), 2026-09-29
--
-- Same thing the Dashboard "Database Webhooks" page creates: an AFTER INSERT
-- trigger on squad_events calling supabase_functions.http_request.
--
-- The x-webhook-secret header is COPIED from the existing Cloud Function
-- webhook (notifyNewMessage / notifyGroupMessage), so the secret never
-- appears in this file or on screen. Run after 034. Idempotent.
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
    raise exception '035: no existing Cloud Function webhook with x-webhook-secret found to copy headers from';
  end if;

  execute 'drop trigger if exists notify_squad_event on public.squad_events';
  execute format(
    'create trigger notify_squad_event after insert on public.squad_events '
    'for each row execute function supabase_functions.http_request(%L, %L, %L, %L, %L)',
    'https://us-central1-adoptme-7b50c.cloudfunctions.net/notifySquadEvent',
    'POST',
    replace(v_headers, '\\', '\'),
    '{}',
    '5000'
  );
  raise notice '035: notify_squad_event created (headers copied from %)', v_src;
end
$$;

-- Check (shows URLs only, never headers):
select c.relname as table_name, t.tgname as trigger_name,
       split_part(encode(t.tgargs, 'escape'), '\000', 1) as url
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
where t.tgfoid = 'supabase_functions.http_request'::regproc
order by 1, 2;
