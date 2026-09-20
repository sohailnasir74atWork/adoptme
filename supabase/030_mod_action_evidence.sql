-- =====================================================================
-- 030_mod_action_evidence.sql — screenshots attached to a moderation action
--
-- WHY
-- 029 gave moderation a history but no evidence. "Scamming" in the reason
-- field is an assertion; the screenshot behind it is the proof. Appeals,
-- second opinions and "why is this person banned?" all previously came
-- down to trusting whichever mod typed the reason.
--
-- A mod attaching a ban can now include up to three images. They render as
-- thumbnails on the action in the dashboard's Moderation record panel and
-- open one by one full screen.
--
-- WHERE THE IMAGES LIVE
-- Bunny (`post-gag`), the same zone the status feed uploads to. That was a
-- deliberate call on 2026-09-19 to reuse the working upload path. Know what
-- it means before relying on this:
--
--   * The zone's write key ships inside the app and the pull zone is
--     public-read, so these URLs are readable by anyone who has one and
--     deletable by anyone holding the key. This column stores evidence, not
--     secrets — do not treat a missing image as suspicious, and do not
--     treat a present one as tamper-proof.
--   * Paths are UUIDs under a `mod-evidence/` prefix and carry nothing
--     about the target, so a leaked URL exposes one image and not who it
--     concerns. See Code/Helper/modEvidenceUpload.js.
--
-- Moving to a private store later (Supabase bucket + RLS on is_mod_staff()
-- + signed URLs) changes the uploader and the viewer's URL resolution. It
-- does NOT change this column: it would still hold a list of strings.
--
-- COST
-- Text array on a table that takes tens of rows a day, still outside the
-- realtime publication. The retention job in 029 removes the rows; it does
-- NOT remove the images from Bunny, which is the honest trade of putting
-- them in a store this table cannot reach.
-- =====================================================================

alter table public.mod_actions
  add column if not exists evidence_urls text[];

-- Three is the product limit, enforced here too so a client bug cannot
-- write a fourth. Null and empty both mean "no evidence" — the client
-- writes null, older rows already are.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mod_actions_evidence_max_3'
  ) then
    alter table public.mod_actions
      add constraint mod_actions_evidence_max_3
      check (evidence_urls is null or array_length(evidence_urls, 1) <= 3);
  end if;
end $$;

comment on column public.mod_actions.evidence_urls is
  'Up to 3 screenshot URLs attached by the acting mod. Public Bunny CDN URLs — see 030 header.';

-- ---------------------------------------------------------------------
-- The read RPCs in 029 (mod_actions_for_user, mod_actions_recent) are
-- `returns setof public.mod_actions` and select *, so they pick the new
-- column up with no change. Re-running 029 after this file is safe.
--
-- Nothing is added to the realtime publication, per 029's cost note.
-- ---------------------------------------------------------------------
