-- =====================================================================
-- 045_chat_ban_enforcement.sql
--
-- Server-side enforcement of chat BANS and the chat LINK rule on all three
-- chat tables:
--
--   public.messages          public rooms      (direct INSERT)
--   public.private_messages  1-on-1 chats      (direct INSERT)
--   public.group_messages    group chats       (send_group_message RPC, 010)
--
-- WHY THIS EXISTS
-- Same reasoning as 023_chat_availability.sql and 028_safe_chat_minors.sql:
-- the app refuses to send while you are banned and strips links client-side,
-- but that is cosmetic. The website talks to the same Supabase directly with
-- the user's Firebase ID token, and anyone can POST to PostgREST by hand.
-- Bans live only in RTDB banned_users_by_email/{key}, which Postgres could not
-- see, so a user banned in the app could keep chatting from the website.
-- These BEFORE triggers make the database the authority for every client.
--
-- WHERE THE DATA COMES FROM
--   chat_bans      ← RTDB banned_users_by_email/{emailKey}
--   chat_settings  ← RTDB links_allowed
-- kept in sync by functions/mirrorBansToSupabase.js, seeded once by
-- scripts/backfillChatBans.js. Service-role writes only.
--
-- WHO IS CHECKED
-- Only END-USER requests: a JWT carrying a Firebase uid (`sub`). Service-role
-- inserts (bots, Cloud Functions, backfills), pg_cron and the SQL editor carry
-- no uid and pass through untouched — sendUpdateNoticeMessage, for one, posts
-- store links into public chat on purpose. Unauthenticated callers cannot
-- insert anyway (RLS needs sender_id = firebase_uid(); 010 needs a caller).
-- Staff (public.is_staff(): admins, full moderators, owner emails — see 039)
-- are exempt from both checks, matching canBypassModeration in the app.
--
-- THE JWT INSIDE send_group_message (010)
-- group_messages rows are inserted by a SECURITY DEFINER function. That does
-- NOT hide the caller from these triggers: SECURITY DEFINER switches
-- current_user (privileges) and applies only the GUCs in the function's own
-- SET clause (search_path). request.jwt.claims is a transaction-local GUC
-- PostgREST sets before running the request; it is inherited unchanged by
-- every function and trigger in that transaction. auth.jwt() therefore still
-- returns the caller's Firebase claims inside the trigger. That is also why
-- these functions read the role from the JWT and never from current_user,
-- which inside 010 is the definer (postgres), not the caller.
--
-- NO MEMBERSHIP CHECK IS ADDED TO send_group_message, deliberately.
-- Membership lives in Firestore /groups/{groupId}/memberIds. group_meta_data
-- is populated lazily by the fan-out RPC, so a Postgres-side membership check
-- rejects legitimate members on their first send — the exact bug 010 was
-- written to fix (see its header). Reads stay gated by is_group_member() and
-- pushes by notifyGroupMessage's Firestore check.
--
-- UPDATES ARE COVERED TOO
-- RLS lets any signed-in user UPDATE public.messages, participants UPDATE
-- private_messages, and members UPDATE group_messages. Without an UPDATE
-- trigger a banned user could post "hi" and then PATCH the text into
-- anything. The app never updates content columns (only deleted*, report
-- count), so both triggers also fire on UPDATE OF the content columns, and
-- only act when the content actually changed. Soft deletes and reports by
-- banned users still work.
--
-- LINK RULE — parity with the app (Code/Helper/ContentModeration.js)
--   URL_PATTERNS:          /https?:\/\//i  /www\./i
--                          /\.(com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|
--                              link|click|online|site|website|web|blog|shop|
--                              store|buy|sale|deal)/i
--   ALLOWED_LINK_PATTERNS: youtube.com/  youtu.be/  tiktok.com/  vm.tiktok.com/
-- Translated FAITHFULLY, including the missing trailing word boundary: ".co"
-- also matches ".community", "...me too" matches ".me". That over-blocks, but
-- the app already blocks exactly those strings before sending, so parity means
-- no app send is newly rejected. Adding \M would make the website more lenient
-- than the app; change both or neither.
-- Exceptions, in the same order the app applies them:
--   * staff (is_staff())
--   * chat_settings.links_allowed = true   (Admin Dashboard → Restrictions)
--   * group_messages only: text containing a YouTube/TikTok link. Like the
--     app's isAllowedLink(), ONE allowed link lets the whole message through.
-- Only `text` is checked: reply_to quotes and pet names are left alone, as in
-- the app.
-- public.messages.contains_link is set to true when an accepted message's
-- text contains a link (it is never cleared — the client's own value wins).
--
-- ERRORS RAISED (errcode check_violation / 23514, same as 023 and 028; match
-- on the message text, which PostgREST returns as error.message):
--   USER_BANNED        caller has an active ban or mute
--   LINKS_NOT_ALLOWED  text contains a link the caller may not send
--
-- COST: chat_bans / chat_settings are NOT in the realtime publication. Each
-- chat insert adds one primary-key/index probe on chat_bans; the link check is
-- one regex and only reads chat_settings when the text has a link.
--
-- ---------------------------------------------------------------------
-- HOW TO RUN THIS — ONE STEP AT A TIME, AND IN ORDER
-- ---------------------------------------------------------------------
-- Same discipline as 028: do NOT paste the whole file into the SQL Editor.
-- STEP 1 only creates new objects and touches no hot table. STEPs 2-4 each
-- arm one hot table, take a brief lock on it, and set lock_timeout so they
-- fail cleanly instead of queueing app traffic. Every step is idempotent.
--
-- Recommended order: STEP 1 → deploy mirrorBansToSupabase +
-- mirrorLinksAllowedToSupabase → node scripts/backfillChatBans.js --apply →
-- STEPs 2-4. For bans, arming earlier is harmless: an empty chat_bans bans
-- nobody (fails OPEN). For links it is NOT: chat_settings.links_allowed
-- starts false, so if RTDB /links_allowed is currently true, app users would
-- get LINKS_NOT_ALLOWED until the mirror/backfill copies the switch across.
-- =====================================================================


-- =====================================================================
-- STEP 0 — Read-only. Where am I?
-- =====================================================================
select
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename in ('chat_bans', 'chat_settings')) as step1_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('chat_ban_key', '_chat_end_user_uid', 'caller_is_chat_banned',
                        'chat_links_allowed', 'chat_text_has_link',
                        'chat_text_has_allowed_link', '_chat_content_changed',
                        'enforce_chat_ban', 'enforce_chat_links'))       as step1_functions,
  (select count(*) from pg_trigger
    where tgname in ('trg_aa_chat_ban', 'trg_ab_chat_links')
      and tgrelid = 'public.messages'::regclass)                         as step2_messages,
  (select count(*) from pg_trigger
    where tgname in ('trg_aa_chat_ban', 'trg_ab_chat_links')
      and tgrelid = 'public.private_messages'::regclass)                 as step3_private,
  (select count(*) from pg_trigger
    where tgname in ('trg_aa_chat_ban', 'trg_ab_chat_links')
      and tgrelid = 'public.group_messages'::regclass)                   as step4_group;
-- Fully applied: 2 | 9 | 2 | 2 | 2


-- =====================================================================
-- STEP 1 — Tables, policies and functions.
--
-- Touches nothing live traffic writes to. Safe to re-run at any time, even
-- after the triggers are armed: it takes chat_bans BEFORE chat_settings, the
-- same order the armed triggers read them in, so a re-run cannot deadlock
-- against live inserts (the 028 lesson).
-- =====================================================================
set lock_timeout = '5s';

-- 1a. chat_bans ---------------------------------------------------------
-- One row per RTDB banned_users_by_email/{emailKey} record. email_key is the
-- app's encodeEmailForBan(): lower(trim(email)) with '.' → '(dot)'.
-- bannedUntil 'permanent' → permanent = true; a number → banned_until_ms.
-- Anything else (missing, string, null) → neither, i.e. not banned, which is
-- how GlobelStats treats it too. Expired rows are inert; nothing needs to
-- delete them.
create table if not exists public.chat_bans (
  email_key        text primary key,
  user_id          text,                     -- record.userId (Firebase uid), may be null
  banned_until_ms  bigint,                   -- ms epoch, null when permanent / unknown
  permanent        boolean not null default false,
  strike_count     integer,
  reason           text,
  source_event_at  timestamptz,              -- RTDB event time that wrote this row (mirror ordering guard); null = backfill
  updated_at       timestamptz not null default now()
);

create index if not exists idx_chat_bans_user_id
  on public.chat_bans (user_id)
  where user_id is not null;

alter table public.chat_bans enable row level security;

-- Clients may read their OWN ban (the website shows "you are banned until …"),
-- matched by uid or by the email in their token. No write policy: service
-- role only.
revoke all on table public.chat_bans from anon, authenticated;
grant select on table public.chat_bans to authenticated;

-- Key helper. Mirrors encodeEmailForBan() in Code/ChatScreen/utils.js.
create or replace function public.chat_ban_key(email text)
returns text
language sql
immutable
as $$
  select nullif(replace(lower(btrim(email)), '.', '(dot)'), '');
$$;

drop policy if exists "chat_bans read own" on public.chat_bans;
create policy "chat_bans read own"
  on public.chat_bans for select
  to authenticated
  using (
    user_id = public.firebase_uid()
    or email_key = public.chat_ban_key(auth.jwt() ->> 'email')
  );

-- 1b. chat_settings -----------------------------------------------------
-- Tiny key/value table for global chat switches. Today: 'links_allowed',
-- mirrored from RTDB /links_allowed (only an explicit true turns it on, same
-- as linksSwitch.js). Readable by everyone, written by service role only.
create table if not exists public.chat_settings (
  key         text primary key,
  enabled     boolean not null default false,
  updated_at  timestamptz not null default now()
);

alter table public.chat_settings enable row level security;

revoke all on table public.chat_settings from anon, authenticated;
grant select on table public.chat_settings to anon, authenticated;

drop policy if exists "chat_settings read all" on public.chat_settings;
create policy "chat_settings read all"
  on public.chat_settings for select
  using (true);

-- Default OFF, like the app. Never overwrites a mirrored value.
insert into public.chat_settings (key, enabled)
values ('links_allowed', false)
on conflict (key) do nothing;

reset lock_timeout;

-- 1c. Who is the end user? ----------------------------------------------
-- Firebase uid from the request JWT, or NULL for anything that is not an end
-- user: service role, anon key, pg_cron, SQL editor.
--
-- Same claim precedence as public.firebase_uid() (firebase_uid, then sub),
-- but read through auth.jwt(), which treats an EMPTY request.jwt.claims as
-- NULL. firebase_uid() casts current_setting() straight to jsonb and throws on
-- '' — harmless inside RLS, but these triggers fire on every insert from every
-- connection, so they must not be able to throw on a non-PostgREST session.
-- Everything below that calls firebase_uid()/is_staff() does so only after
-- this has returned a uid, i.e. only when the claims are valid JSON.
create or replace function public._chat_end_user_uid()
returns text
language sql
stable
set search_path = public
as $$
  select case
           when coalesce(auth.jwt() ->> 'role', '') = 'service_role' then null
           else nullif(coalesce(auth.jwt() ->> 'firebase_uid', auth.jwt() ->> 'sub'), '')
         end;
$$;

-- 1d. Is the caller banned? ---------------------------------------------
-- True when a chat_bans row matches the caller by uid OR by the email in the
-- Firebase ID token, and is permanent or not yet expired. Staff → false.
-- Callable by the website as rpc('caller_is_chat_banned') — it only ever
-- answers about the caller.
create or replace function public.caller_is_chat_banned()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid text := public._chat_end_user_uid();
  v_key text;
begin
  if v_uid is null then
    return false;
  end if;

  v_key := public.chat_ban_key(auth.jwt() ->> 'email');

  if not exists (
    select 1
      from public.chat_bans b
     where (b.user_id = v_uid or b.email_key = v_key)
       and (b.permanent
            or b.banned_until_ms > (extract(epoch from now()) * 1000))
  ) then
    return false;
  end if;

  -- Only reached for banned callers, so the user_roles probe in is_staff()
  -- costs nothing on the normal path. is_staff() (039) is SECURITY DEFINER,
  -- STABLE and coalesce()d, so it never returns NULL.
  return not public.is_staff();
end;
$$;

-- 1e. Link helpers --------------------------------------------------------
-- [.] instead of \. so the patterns do not depend on
-- standard_conforming_strings. ~* = case-insensitive, like the JS /i flag.
create or replace function public.chat_text_has_link(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_text ~* '(https?://|www[.]|[.](com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|link|click|online|site|website|web|blog|shop|store|buy|sale|deal))',
    false);
$$;

create or replace function public.chat_text_has_allowed_link(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_text ~* '(?:https?://)?(?:www[.])?(?:youtube[.]com|youtu[.]be)/|(?:https?://)?(?:www[.])?tiktok[.]com/|(?:https?://)?vm[.]tiktok[.]com/',
    false);
$$;

create or replace function public.chat_links_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.enabled from public.chat_settings s where s.key = 'links_allowed'),
    false);
$$;

-- Did an UPDATE change what the message says or shows? Works for all three
-- tables: to_jsonb(row) -> 'missing_column' is NULL on both sides.
create or replace function public._chat_content_changed(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
as $$
  select (p_old -> 'text')       is distinct from (p_new -> 'text')
      or (p_old -> 'gif_url')    is distinct from (p_new -> 'gif_url')
      or (p_old -> 'image_url')  is distinct from (p_new -> 'image_url')
      or (p_old -> 'image_urls') is distinct from (p_new -> 'image_urls')
      or (p_old -> 'fruits')     is distinct from (p_new -> 'fruits');
$$;

-- 1f. The gates -----------------------------------------------------------
-- Created here as plain functions; STEPs 2-4 attach them.
create or replace function public.enforce_chat_ban()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nested rather than AND-ed: SQL does not promise short-circuit evaluation,
  -- and OLD is NULL on INSERT.
  if tg_op = 'UPDATE' then
    if not public._chat_content_changed(to_jsonb(old), to_jsonb(new)) then
      return new;
    end if;
  end if;

  if public.caller_is_chat_banned() then
    raise exception 'USER_BANNED'
      using errcode = 'check_violation',
            hint = 'You are banned from chat.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_chat_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.text is not distinct from old.text then
      return new;
    end if;
  end if;

  -- Service role / cron / SQL editor: untouched, contains_link included.
  if public._chat_end_user_uid() is null then
    return new;
  end if;

  if not public.chat_text_has_link(new.text) then
    return new;
  end if;

  -- Only public.messages has contains_link. plpgsql resolves NEW fields at
  -- run time, so this line is never evaluated for the other two tables.
  if tg_table_name = 'messages' then
    new.contains_link := true;
  end if;

  if public.chat_links_allowed() then
    return new;
  end if;

  if tg_table_name = 'group_messages'
     and public.chat_text_has_allowed_link(new.text) then
    return new;
  end if;

  if public.is_staff() then
    return new;
  end if;

  raise exception 'LINKS_NOT_ALLOWED'
    using errcode = 'check_violation',
          hint = 'Links are not allowed in chat.';
end;
$$;

-- 1g. Grants --------------------------------------------------------------
-- Supabase grants EXECUTE on new public functions to PUBLIC/anon by default
-- (see 043). Pure helpers and caller_is_chat_banned() are useful to the
-- website, so signed-in users keep them; internals and the trigger functions
-- are callable by nobody but the definer. Triggers reach everything as the
-- definer regardless.
do $$
declare
  v_fn   text;
  v_role text;
begin
  foreach v_fn in array array[
    'public.chat_ban_key(text)',
    'public.caller_is_chat_banned()',
    'public.chat_text_has_link(text)',
    'public.chat_text_has_allowed_link(text)',
    'public.chat_links_allowed()',
    'public._chat_end_user_uid()',
    'public._chat_content_changed(jsonb, jsonb)',
    'public.enforce_chat_ban()',
    'public.enforce_chat_links()'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end if;
    end loop;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach v_fn in array array[
      'public.chat_ban_key(text)',                -- also needed by the chat_bans RLS policy
      'public.caller_is_chat_banned()',
      'public.chat_text_has_link(text)',
      'public.chat_text_has_allowed_link(text)',
      'public.chat_links_allowed()'
    ] loop
      execute format('grant execute on function %s to authenticated', v_fn);
    end loop;
  end if;
end
$$;


-- =====================================================================
-- STEP 2 — Arm public.messages.  Run after the backfill.
--
-- Postgres fires BEFORE triggers alphabetically: trg_aa_* run first, so a
-- ban wins over a link rejection.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_aa_chat_ban on public.messages;
create trigger trg_aa_chat_ban
  before insert or update of text, gif_url, fruits on public.messages
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_ab_chat_links on public.messages;
create trigger trg_ab_chat_links
  before insert or update of text on public.messages
  for each row execute function public.enforce_chat_links();

reset lock_timeout;


-- =====================================================================
-- STEP 3 — Arm public.private_messages.
--
-- Sorts before trg_reject_unavailable_chat (023) and trg_zz_enforce_safe_chat
-- (028), so a banned sender sees USER_BANNED rather than a recipient-side
-- reason.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_aa_chat_ban on public.private_messages;
create trigger trg_aa_chat_ban
  before insert or update of text, image_url, image_urls, fruits on public.private_messages
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_ab_chat_links on public.private_messages;
create trigger trg_ab_chat_links
  before insert or update of text on public.private_messages
  for each row execute function public.enforce_chat_links();

reset lock_timeout;


-- =====================================================================
-- STEP 4 — Arm public.group_messages.
--
-- Fires inside send_group_message (010); see "THE JWT INSIDE
-- send_group_message" above for why the caller is still visible. Note that
-- BEFORE INSERT triggers run before ON CONFLICT is resolved, so a banned
-- user's idempotent retry gets USER_BANNED rather than the old row.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_aa_chat_ban on public.group_messages;
create trigger trg_aa_chat_ban
  before insert or update of text, image_url, image_urls, fruits on public.group_messages
  for each row execute function public.enforce_chat_ban();

drop trigger if exists trg_ab_chat_links on public.group_messages;
create trigger trg_ab_chat_links
  before insert or update of text on public.group_messages
  for each row execute function public.enforce_chat_links();

reset lock_timeout;


-- =====================================================================
-- SMOKE TEST (read-only; run as an ordinary signed-in user, e.g. from the
-- website console with supabase-js):
--   await supabase.rpc('caller_is_chat_banned')            -- false normally
--   await supabase.rpc('chat_text_has_link', { p_text: 'see x.com' })  -- true
--   await supabase.from('chat_bans').select('*')           -- own row only
-- =====================================================================


-- =====================================================================
-- ROLLBACK — triggers first so enforcement stops immediately.
--   set lock_timeout = '5s';
--   drop trigger if exists trg_aa_chat_ban   on public.messages;
--   drop trigger if exists trg_ab_chat_links on public.messages;
--   drop trigger if exists trg_aa_chat_ban   on public.private_messages;
--   drop trigger if exists trg_ab_chat_links on public.private_messages;
--   drop trigger if exists trg_aa_chat_ban   on public.group_messages;
--   drop trigger if exists trg_ab_chat_links on public.group_messages;
--   reset lock_timeout;
--   -- Optional full removal (inert once the triggers are gone):
--   drop function if exists public.enforce_chat_links();
--   drop function if exists public.enforce_chat_ban();
--   drop function if exists public._chat_content_changed(jsonb, jsonb);
--   drop function if exists public.chat_links_allowed();
--   drop function if exists public.chat_text_has_allowed_link(text);
--   drop function if exists public.chat_text_has_link(text);
--   drop function if exists public.caller_is_chat_banned();
--   drop function if exists public._chat_end_user_uid();
--   drop policy   if exists "chat_bans read own" on public.chat_bans;
--   drop function if exists public.chat_ban_key(text);
--   drop table    if exists public.chat_settings;
--   drop table    if exists public.chat_bans;
-- =====================================================================
