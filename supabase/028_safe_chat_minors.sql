-- =====================================================================
-- 028_safe_chat_minors.sql
--
-- SAFE CHAT — server-side enforcement of the under-13 private-message rule.
--
-- THE RULE
-- A private thread where EITHER participant is under 13 opens normally, but
-- both sides may then send only:
--   * a phrase from the vetted catalogue (Code/ChatScreen/safeTemplates.js),
--   * the sender's own saved Roblox username, so a trade can happen,
--   * pets from the fixed value catalogue, and replies.
-- No free text. No photos. Everything else about the account is unaffected:
-- under-13 users still trade, post to the feed and talk in group chat.
--
-- WHY THIS LIVES IN THE DATABASE
-- Same reasoning as 023_chat_availability.sql: the app hides the keyboard, but
-- that is cosmetic. Older builds have never heard of safe chat, and a modified
-- client can post whatever it likes straight to PostgREST. Putting the check in
-- a BEFORE INSERT trigger makes the guarantee hold for every client that has
-- ever shipped.
--
-- Ages come from user_identity.date_of_birth, which mirrorUsersToSupabase keeps
-- in sync with RTDB users/{uid}/dateOfBirth (mandatory — DateOfBirthModal gates
-- the app on it).
--
-- KNOWN GAP, ACCEPTED
-- A brand-new account has no user_identity row until the mirror CF runs
-- (typically sub-second). In that window this trigger reads them as not-a-minor
-- and lets free text through. Failing the other way would block messaging to
-- every newly created account, which is a far larger and far more common harm.
-- The child's own client restricts itself from the first render regardless,
-- since it reads its own DOB locally.
--
-- ---------------------------------------------------------------------
-- HOW TO RUN THIS — ONE STEP AT A TIME, AND IN ORDER
-- ---------------------------------------------------------------------
-- Do NOT paste the whole file into the SQL Editor. Run STEP 1, wait for it to
-- report success, then STEP 2, and so on. The first attempt at this migration
-- deadlocked in production precisely because it was one transaction:
--
--     ERROR: 40P01: deadlock detected
--     Process A waits for AccessExclusiveLock on private_messages
--     Process B waits for AccessShareLock on safe_chat_templates
--
-- Once the trigger exists, every insert into private_messages reads
-- safe_chat_templates, so LIVE TRAFFIC LOCKS private_messages THEN
-- safe_chat_templates. A migration that holds safe_chat_templates while
-- waiting for private_messages takes those two locks in the opposite order,
-- and Postgres kills one of the pair. Splitting the work means no transaction
-- here ever holds one of those relations while waiting for the other.
--
-- Every step is idempotent, so re-running one that already succeeded is safe.
-- Steps 2 and 4 touch the hot private_messages table and therefore set
-- lock_timeout: if they cannot get the lock quickly they fail cleanly instead
-- of queueing every app query behind them. If one times out, retry off-peak —
-- a timeout means a long-running transaction was holding the table, not that
-- anything is broken.
--
-- Deploy the app build BEFORE or AFTER any of this, in any order: the client
-- drops `tpl` from its reads and writes when the column is missing, so the two
-- never have to land together.
-- =====================================================================


-- =====================================================================
-- STEP 0 — Read-only. Where am I?
-- Run this first, and again between steps, to see what is already applied.
-- Catalog views only, so it works on a database where nothing has been applied
-- yet. To count the seeded rows, run this once STEP 1 reports success:
--     select count(*) from public.safe_chat_templates;   -- expect 42
-- =====================================================================
select
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename = 'safe_chat_templates')  as step1_table,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('dob_age_years', 'safe_chat_minor_age',
                        'safe_chat_required', 'safe_chat_staff_exempt',
                        'enforce_safe_chat'))                           as step1_functions,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'private_messages'
      and column_name = 'tpl')                                          as step2_column,
  (select count(*) from pg_constraint
    where conname = 'private_messages_tpl_check')                       as step2_constraint,
  (select count(*) from pg_constraint
    where conname = 'private_messages_tpl_check' and convalidated)      as step3_validated,
  (select count(*) from pg_trigger
    where tgname = 'trg_zz_enforce_safe_chat')                          as step4_trigger;


-- ---------------------------------------------------------------------
-- IF STEP 0 SHOWS step4_trigger = 1 AND step2_column = 0, FIX IT NOW
-- ---------------------------------------------------------------------
-- That combination means an earlier attempt armed the trigger before the
-- column existed. enforce_safe_chat() reads new.tpl, and plpgsql resolves that
-- field at runtime, so every send in a thread involving an under-13 user is
-- currently failing with:
--     record "new" has no field "tpl"
-- Threads between two adults are unaffected (the function returns before it
-- reads tpl), so this is easy to miss.
--
-- Either run STEP 2 right away, or disarm until you can:
--     set lock_timeout = '5s';
--     drop trigger if exists trg_zz_enforce_safe_chat on public.private_messages;
--     reset lock_timeout;
-- ---------------------------------------------------------------------


-- =====================================================================
-- STEP 1 — Catalogue, seed and functions.
--
-- Touches nothing that live traffic writes to, so it cannot deadlock and can
-- run at any time of day. Creating the functions before the trigger also keeps
-- the final step down to a single fast statement rather than a long
-- transaction holding a lock on the busiest table in the database.
-- =====================================================================

-- Canonical English copy, mirrored from Code/ChatScreen/safeTemplates.js.
-- Regenerate the seed below with:
--     node scripts/gen-safe-templates-sql.js --write
create table if not exists public.safe_chat_templates (
  id       text primary key,
  text_en  text not null,
  category text not null
);

-- Reply sanitising (STEP 4's trigger) looks a quoted string up by its value.
create index if not exists idx_safe_chat_templates_text
  on public.safe_chat_templates (text_en);

-- Same, for the game-ID path. Plain rather than CONCURRENTLY because the SQL
-- Editor wraps each run in a transaction and CONCURRENTLY cannot run inside
-- one. It briefly blocks writes to user_roblox, which is a small, rarely
-- written profile table — unlike private_messages, this is not a hot path.
create index if not exists idx_user_roblox_username
  on public.user_roblox (roblox_username);

-- Read-only to clients: the app needs the list to be a fixed, known quantity,
-- and it already ships the same list in JS. Writes are service-role only.
alter table public.safe_chat_templates enable row level security;

drop policy if exists safe_chat_templates_read on public.safe_chat_templates;
create policy safe_chat_templates_read
  on public.safe_chat_templates for select
  using (true);


-- >>> SEED BEGIN (generated by scripts/gen-safe-templates-sql.js) <<<
insert into public.safe_chat_templates (id, text_en, category) values
  ('interest', 'Interested in your trade!', 'trade'),
  ('available', 'Is this still available?', 'trade'),
  ('what_pets', 'What pets do you have?', 'trade'),
  ('have_item', 'I have what you need', 'trade'),
  ('negotiate', 'Can we negotiate?', 'trade'),
  ('best_offer', 'What''s your best offer?', 'trade'),
  ('add_more', 'Can you add more?', 'trade'),
  ('add_pets', 'I''ll add more pets', 'trade'),
  ('change_item', 'Can you change something?', 'trade'),
  ('fair_trade', 'Fair trade, let''s do it!', 'trade'),
  ('make_deal', 'Let''s make a deal!', 'trade'),
  ('can_do', 'Can we do this trade?', 'trade'),
  ('discuss', 'I''m interested, let''s discuss', 'trade'),
  ('check_inv', 'Let me check my inventory', 'trade'),
  ('ready', 'I''m ready to trade!', 'trade'),
  ('deal_accepted', 'Deal accepted!', 'trade'),
  ('meet_hub', 'Meet me at the trading hub', 'trade'),
  ('when', 'When can you trade?', 'trade'),
  ('online', 'Are you online?', 'trade'),
  ('thanks', 'Thanks for the trade!', 'trade'),
  ('hi', 'Hi!', 'friendly'),
  ('how_are_you', 'How are you?', 'friendly'),
  ('im_good', 'I''m good, thanks!', 'friendly'),
  ('yes', 'Yes', 'friendly'),
  ('no', 'No', 'friendly'),
  ('ok', 'OK!', 'friendly'),
  ('thank_you', 'Thank you!', 'friendly'),
  ('youre_welcome', 'You''re welcome!', 'friendly'),
  ('please_wait', 'One moment please', 'friendly'),
  ('brb', 'Be right back', 'friendly'),
  ('im_back', 'I''m back!', 'friendly'),
  ('good_luck', 'Good luck!', 'friendly'),
  ('congrats', 'Congrats!', 'friendly'),
  ('nice_pets', 'Nice pets!', 'friendly'),
  ('have_fun', 'Have fun!', 'friendly'),
  ('not_interested', 'Sorry, not interested', 'friendly'),
  ('maybe_later', 'Maybe later', 'friendly'),
  ('gtg', 'Got to go', 'friendly'),
  ('see_you', 'See you later!', 'friendly'),
  ('keep_trading', 'Let''s keep this about trading', 'safety'),
  ('no_personal_info', 'I don''t share personal info', 'safety'),
  ('stop_asking', 'Please stop asking me that', 'safety')
on conflict (id) do update
  set text_en  = excluded.text_en,
      category = excluded.category;

-- Anything no longer in the catalogue stops being sendable. Existing
-- messages that used it are untouched — this table only gates new inserts.
delete from public.safe_chat_templates
 where id not in ('interest', 'available', 'what_pets', 'have_item', 'negotiate', 'best_offer', 'add_more', 'add_pets', 'change_item', 'fair_trade', 'make_deal', 'can_do', 'discuss', 'check_inv', 'ready', 'deal_accepted', 'meet_hub', 'when', 'online', 'thanks', 'hi', 'how_are_you', 'im_good', 'yes', 'no', 'ok', 'thank_you', 'youre_welcome', 'please_wait', 'brb', 'im_back', 'good_luck', 'congrats', 'nice_pets', 'have_fun', 'not_interested', 'maybe_later', 'gtg', 'see_you', 'keep_trading', 'no_personal_info', 'stop_asking');
-- >>> SEED END <<<


-- Age helpers --------------------------------------------------------
-- date_of_birth is TEXT ('YYYY-MM-DD') because RTDB stores it that way, so a
-- bare ::date would throw on any malformed row and take the whole insert with
-- it. Unparseable, absent and future dates all return NULL, which reads as
-- "not known to be a minor" at the call sites below.
create or replace function public.dob_age_years(p_dob text)
returns integer
language plpgsql
stable
set search_path = public
as $$
declare
  v_date date;
begin
  if p_dob is null or p_dob !~ '^\d{4}-\d{1,2}-\d{1,2}$' then
    return null;
  end if;

  begin
    v_date := p_dob::date;
  exception when others then
    return null;    -- e.g. '2024-13-45' passes the regex but is not a date
  end;

  if v_date > current_date then
    return null;
  end if;

  return extract(year from age(current_date, v_date))::int;
end;
$$;

comment on function public.dob_age_years(text) is
  'Whole years old today from a YYYY-MM-DD string; NULL if absent/unparseable/future.';

-- Keep the threshold in one place. Mirrors MINOR_AGE_THRESHOLD in
-- Code/Helper/ageGate.js.
create or replace function public.safe_chat_minor_age()
returns integer
language sql
immutable
as $$ select 13 $$;


-- Is this thread restricted? ------------------------------------------
-- True when either uid is under age. One index scan on user_identity's pkey.
create or replace function public.safe_chat_required(p_uid_a text, p_uid_b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select bool_or(public.dob_age_years(i.date_of_birth) < public.safe_chat_minor_age())
       from public.user_identity i
      where i.uid in (p_uid_a, p_uid_b)),
    false);
$$;


-- Staff exemption -----------------------------------------------------
-- Admins and full moderators can still send ordinary text INTO a safe thread,
-- so support and enforcement messages ("your post was removed") keep working.
-- Baby mods are not exempt. This mirrors canBypassModeration in the app, which
-- already exempts the same two roles from the profanity filter.
--
-- Deliberately one-directional: it is keyed on the SENDER, so the minor on the
-- other side is still restricted to templates. To remove the exemption
-- entirely, make this function `select false`.
create or replace function public.safe_chat_staff_exempt(p_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select r.is_admin or (r.is_moderator and not r.is_baby_mod)
       from public.user_roles r
      where r.uid = p_uid),
    false);
$$;


-- Lock the helpers down -----------------------------------------------
-- They are SECURITY DEFINER and read other people's ages, so no client role
-- should be able to call them directly and probe whether a given uid is a
-- minor. The trigger still reaches them: inside a SECURITY DEFINER function
-- the privilege check runs as the definer, not the caller.
--
-- Supabase grants EXECUTE on new functions to anon/authenticated by default,
-- so revoking from PUBLIC alone is not enough. Roles are revoked only if they
-- exist, which keeps this runnable on a plain Postgres too.
do $$
declare
  v_role text;
  v_fn   text;
begin
  foreach v_fn in array array[
    'public.dob_age_years(text)',
    'public.safe_chat_required(text, text)',
    'public.safe_chat_staff_exempt(text)'
  ] loop
    execute format('revoke all on function %s from public', v_fn);
    foreach v_role in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_role) then
        execute format('revoke all on function %s from %I', v_fn, v_role);
      end if;
    end loop;
  end loop;
end
$$;


-- The gate itself ------------------------------------------------------
-- Created here as a plain function. Defining it touches nothing on
-- private_messages; only STEP 4, which attaches it as a trigger, does.
create or replace function public.enforce_safe_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical  text;
  v_game_id    text;
  v_text       text;
begin
  if not public.safe_chat_required(new.sender_id, new.recipient_id) then
    return new;
  end if;

  if public.safe_chat_staff_exempt(new.sender_id) then
    return new;
  end if;

  -- No photos, in either direction, under any client.
  if new.image_url is not null
     or (new.image_urls is not null
         and jsonb_typeof(new.image_urls) = 'array'
         and jsonb_array_length(new.image_urls) > 0) then
    raise exception 'SAFE_CHAT_NO_IMAGES'
      using errcode = 'check_violation',
            hint = 'Photos cannot be sent in a chat involving a minor.';
  end if;

  v_text := btrim(coalesce(new.text, ''));

  if v_text <> '' then
    if new.tpl is null then
      raise exception 'SAFE_CHAT_TEMPLATE_REQUIRED'
        using errcode = 'check_violation',
              hint = 'Only vetted template messages are allowed in this chat.';
    end if;

    if new.tpl = 'game_id' then
      -- The one non-fixed string allowed. It must be the username already on
      -- the SENDER's own profile, which Settings round-trips through the real
      -- Roblox API before saving. That is what stops this being a free-text
      -- hole: an attacker would have to get their sentence accepted as a
      -- Roblox account name first.
      select btrim(coalesce(r.roblox_username, ''))
        into v_game_id
        from public.user_roblox r
       where r.uid = new.sender_id;

      if coalesce(v_game_id, '') = '' or v_game_id <> v_text then
        raise exception 'SAFE_CHAT_BAD_GAME_ID'
          using errcode = 'check_violation',
                hint = 'A game ID must match the username saved on your own profile.';
      end if;
    else
      select t.text_en
        into v_canonical
        from public.safe_chat_templates t
       where t.id = new.tpl;

      if v_canonical is null or v_canonical <> v_text then
        raise exception 'SAFE_CHAT_BAD_TEMPLATE'
          using errcode = 'check_violation',
                hint = 'Message text must match the template it claims to be.';
      end if;
    end if;
  end if;

  -- Attached pets render their `name`, so that field is a text channel too.
  -- Every name in the app's own catalogue is letters/digits/spaces/hyphens and
  -- at most 40 characters (verified against Code/Helper/filter.js — [:alnum:]
  -- rather than A-Za-z so accented names like 'Tió De Nadal' pass), so anything
  -- outside that shape did not come from the picker. The charset rules out
  -- URLs, emails and @handles outright; the digit cap rules out phone numbers
  -- while still allowing names like 'Birthday Butterfly 2024'.
  --
  -- RESIDUAL RISK, ACCEPTED: a repackaged client could still put ~48 characters
  -- of plain words in a pet name. Closing that needs the full item catalogue in
  -- Postgres, kept in sync with a live-updating values dataset — a large amount
  -- of machinery for a channel that requires a modified app binary to reach.
  if new.fruits is not null and jsonb_typeof(new.fruits) = 'array' then
    if jsonb_array_length(new.fruits) > 18 then
      raise exception 'SAFE_CHAT_TOO_MANY_ITEMS'
        using errcode = 'check_violation',
              hint = 'Too many items attached.';
    end if;

    if exists (
      select 1
        from jsonb_array_elements(new.fruits) as f
       where coalesce(f->>'name', f->>'Name', '') !~ '^[[:alnum:] ''.-]{1,48}$'
          or (length(coalesce(f->>'name', f->>'Name', ''))
              - length(regexp_replace(coalesce(f->>'name', f->>'Name', ''), '[0-9]', '', 'g'))) > 4
    ) then
      raise exception 'SAFE_CHAT_BAD_ITEM'
        using errcode = 'check_violation',
              hint = 'Attached items must come from the in-app item list.';
    end if;
  end if;

  -- A quoted reply carries a copy of the original's text, which is another way
  -- in. Drop the quote when it is not something this thread could legitimately
  -- have produced, rather than rejecting — the message itself is fine and the
  -- reader can still see which message it answers.
  if new.reply_to is not null
     and jsonb_typeof(new.reply_to) = 'object'
     and coalesce(new.reply_to->>'text', '') <> ''
     and not exists (
       select 1 from public.safe_chat_templates t
        where t.text_en = btrim(new.reply_to->>'text'))
     and not exists (
       select 1 from public.user_roblox r
        where r.uid in (new.sender_id, new.recipient_id)
          and btrim(coalesce(r.roblox_username, '')) = btrim(new.reply_to->>'text')
          and coalesce(r.roblox_username, '') <> '') then
    new.reply_to := new.reply_to - 'text';
  end if;

  return new;
end;
$$;


-- =====================================================================
-- STEP 2 — Add the column and the shape constraint.
--
-- Takes a BRIEF AccessExclusiveLock on private_messages. ADD COLUMN with no
-- default is metadata-only in Postgres 11+, so the lock is held for
-- microseconds — the risk is WAITING for it behind a long transaction, which
-- lock_timeout caps.
--
-- The CHECK is added NOT VALID on purpose. A plain ADD CONSTRAINT ... CHECK
-- scans every row in the chat history while holding that exclusive lock, which
-- on a table this size is an outage. NOT VALID skips the scan and still
-- enforces the rule on every new row; STEP 3 verifies the existing ones.
-- =====================================================================
set lock_timeout = '5s';

alter table public.private_messages
  add column if not exists tpl text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'private_messages_tpl_check') then
    alter table public.private_messages
      add constraint private_messages_tpl_check
      check (tpl is null or tpl ~ '^[a-z0-9_]{1,40}$') not valid;
  end if;
end
$$;

reset lock_timeout;


-- =====================================================================
-- STEP 3 — Validate the constraint.
--
-- Takes only a ShareUpdateExclusiveLock, which does NOT block reads, inserts
-- or updates. It does scan the table, so run it off-peak; it is safe to
-- interrupt and re-run. Every existing row has tpl IS NULL, so this will pass.
-- =====================================================================
alter table public.private_messages
  validate constraint private_messages_tpl_check;


-- =====================================================================
-- STEP 4 — Arm the trigger. RUN THIS LAST.
--
-- Nothing is enforced until this runs, and nothing should run after it. By
-- now safe_chat_templates is COMMITTED and populated, so the first insert that
-- fires the trigger finds a table it can read without waiting on this session.
--
-- Brief AccessExclusiveLock on private_messages again, same lock_timeout
-- reasoning as STEP 2.
--
-- Trigger name sorts after trg_reject_unavailable_chat, and Postgres fires
-- BEFORE triggers alphabetically, so an unavailable-chat rejection still wins.
-- =====================================================================
set lock_timeout = '5s';

drop trigger if exists trg_zz_enforce_safe_chat on public.private_messages;
create trigger trg_zz_enforce_safe_chat
  before insert on public.private_messages
  for each row execute function public.enforce_safe_chat();

reset lock_timeout;


-- =====================================================================
-- ROLLBACK — reverse order, and STEP 4 first so enforcement stops immediately.
--   set lock_timeout = '5s';
--   drop trigger if exists trg_zz_enforce_safe_chat on public.private_messages;
--   reset lock_timeout;
--   drop function if exists public.enforce_safe_chat();
--   drop function if exists public.safe_chat_required(text, text);
--   drop function if exists public.safe_chat_staff_exempt(text);
--   drop function if exists public.safe_chat_minor_age();
--   drop function if exists public.dob_age_years(text);
--   -- private_messages.tpl and safe_chat_templates can stay; both are inert
--   -- without the trigger, and dropping tpl would lose per-reader localisation.
-- =====================================================================
