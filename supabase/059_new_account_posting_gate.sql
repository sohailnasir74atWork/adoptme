-- 059: new-account posting gate for public chat (public.messages).
--
-- Why (2026-10-28, Ops/bugs/LOG.md "Ban evasion through the website"): a
-- banned user keeps returning on fresh email/password accounts made on the
-- website and posts doxxing in public chat within minutes. Device bans never
-- reach those accounts: the device id is stamped only by the app.
--
-- Rule: an account created after this ships cannot post in public chat until
-- it has signed in once on the app (users/{uid}/deviceId stamped) or is 72 h
-- old. Accounts that existed before have no gate row and are unaffected.
--
-- public.posting_gate is written only by Cloud Functions (service role):
--   initPostingGate         auth onCreate  -> row, app_seen_at null
--   markPostingGateAppSeen  users/{uid}/deviceId written by the app -> app_seen_at
-- Firestore posting_gate/{uid} carries the same state for Feed (firestore.rules).
--
-- Brand-new tokens: the role claim is set by the same onCreate pass, so a
-- token minted before it has neither a gate row nor `role`; that pair is
-- treated as new. Every recent poster (31 web chat senders, 322 Feed posters,
-- 14 days to 2026-10-28) carries the role claim.
--
-- Only INSERT is gated: reports and mod soft-deletes (UPDATE) are untouched.

begin;

set local lock_timeout = '3s';

create table if not exists public.posting_gate (
  uid              text primary key,
  created_at       timestamptz not null,   -- Firebase Auth creationTime
  restricted_until timestamptz not null,   -- created_at + 72 h
  app_seen_at      timestamptz,            -- first app sign-in (device stamped)
  updated_at       timestamptz not null default now()
);

alter table public.posting_gate enable row level security;
revoke all on public.posting_gate from anon, authenticated;

create or replace function public.enforce_new_account_gate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  text := public.firebase_uid();
  v_role text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  g      public.posting_gate%rowtype;
begin
  -- Service role, cron, migrations: no Firebase uid.
  if v_uid is null then
    return new;
  end if;

  select * into g from public.posting_gate where uid = v_uid;
  if found then
    if g.app_seen_at is null and now() < g.restricted_until then
      raise exception 'NEW_ACCOUNT_WAIT'
        using errcode = 'check_violation',
              hint = 'New website accounts can post in public chat 72 hours after sign-up, or right away after signing in once on the app.';
    end if;
  elsif v_role is null then
    raise exception 'NEW_ACCOUNT_WAIT'
      using errcode = 'check_violation',
            hint = 'New accounts can post in public chat in a moment.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_new_account_gate() from public, anon, authenticated;

drop trigger if exists trg_ac_new_account_gate on public.messages;
create trigger trg_ac_new_account_gate
  before insert on public.messages
  for each row execute function public.enforce_new_account_gate();

commit;

-- Rollback:
--   drop trigger if exists trg_ac_new_account_gate on public.messages;
-- (table and function can stay; they do nothing without the trigger)
