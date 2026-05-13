-- =====================================================================
-- 007_meta_writable.sql — open chat + group meta to client writes
-- =====================================================================
-- Phase 2 (003_chat_metadata.sql) gave end-users SELECT only; every write
-- went through mirrorChatMetaToSupabase / mirrorGroupMetaToSupabase
-- (service-role, fed by RTDB onWrite). Phase 5 clean-cut flips that:
-- new app builds write chat_meta_data + group_meta_data directly via
-- Supabase. Old builds keep writing RTDB; the mirror CFs keep dribbling
-- those into Supabase. Old vs new builds will not see each other after
-- this ships — accepted tradeoff per user direction 2026-05-12.
--
-- Two-sided semantics:
--   * chat_meta_data: when A sends, A's client writes BOTH owner_uid=A
--     and owner_uid=B rows. Policy permits either side of the pair.
--   * group_meta_data: when A sends, A's client fans out to every group
--     member's row. There's no membership table in Supabase, so the
--     policy trusts any authenticated caller — same trust model as the
--     existing RTDB rules. The notify CF still gates pushes against
--     Firestore /groups/{groupId}/memberIds, so push abuse is contained.
--
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- chat_meta_data: allow either side of the pair to insert/update/delete.
-- ---------------------------------------------------------------------

drop policy if exists "chat_meta_data insert by participant" on public.chat_meta_data;
create policy "chat_meta_data insert by participant"
  on public.chat_meta_data for insert
  with check (
    public.firebase_uid() is not null
    and (owner_uid = public.firebase_uid() or partner_uid = public.firebase_uid())
  );

drop policy if exists "chat_meta_data update by participant" on public.chat_meta_data;
create policy "chat_meta_data update by participant"
  on public.chat_meta_data for update
  using (
    public.firebase_uid() is not null
    and (owner_uid = public.firebase_uid() or partner_uid = public.firebase_uid())
  )
  with check (
    public.firebase_uid() is not null
    and (owner_uid = public.firebase_uid() or partner_uid = public.firebase_uid())
  );

drop policy if exists "chat_meta_data delete by owner" on public.chat_meta_data;
create policy "chat_meta_data delete by owner"
  on public.chat_meta_data for delete
  using (owner_uid = public.firebase_uid());


-- ---------------------------------------------------------------------
-- group_meta_data: any authenticated user can insert/update (the send
-- fan-out hits every member's row). DELETE restricted to row owner —
-- only you can remove your own membership row.
-- ---------------------------------------------------------------------

drop policy if exists "group_meta_data insert authenticated" on public.group_meta_data;
create policy "group_meta_data insert authenticated"
  on public.group_meta_data for insert
  with check (public.firebase_uid() is not null);

drop policy if exists "group_meta_data update authenticated" on public.group_meta_data;
create policy "group_meta_data update authenticated"
  on public.group_meta_data for update
  using (public.firebase_uid() is not null)
  with check (public.firebase_uid() is not null);

drop policy if exists "group_meta_data delete by owner" on public.group_meta_data;
create policy "group_meta_data delete by owner"
  on public.group_meta_data for delete
  using (user_id = public.firebase_uid());
