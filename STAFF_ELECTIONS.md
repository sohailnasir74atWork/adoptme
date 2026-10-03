# Staff Elections: MOD and JMD

Built 2026-10-02. MODs and Junior Mods are no longer picked by hand. Players
apply for a seat, an admin approves the applications, everyone votes on the
approved candidates, and the winners serve a fixed term. Squad size and age
decide who may apply. Trusted, CMSR and Helper badges are given by MODs, but
only to players with 3 or more squad friends.

**Revised the same day (040):** applying replaces self-nomination. An
application waits for an admin in **Admin Dashboard → Elections**; only
approved candidates appear on the ballot. Age gates were added (MOD 18+,
JMD 16+) and the MOD squad bar dropped from 10 to 5. Admins also see a
player's eligibility on their profile. Details in "Applications" below.

**Revised again the same day (041): the admin has the final say.** A closed
race is only *counted*. The tally, who met the bar, and a suggestion land in
**Admin Dashboard → Elections**, and nobody gains or loses a role until an
admin appoints or removes them there, one by one. Nothing is scheduled
automatically any more: the admin starts the next election, and the panel
says when a term has run out. Details in "Results and decisions" below.

---

## On/off switch (admin-only until launch)

The whole feature sits behind RTDB **`/elections_enabled`**, which is **off by
default**. Only an explicit `true` turns it on.

| | Switch OFF (default) | Switch ON |
|---|---|---|
| Players | Nothing is visible: no Home button, no Squad card, no Moderators banner. No server calls. | A slim "🗳️ Staff Elections" button on Home under Pet Cards, with the live race ("Voting open · 2d 4h"). Plus the Squad screen card and the Moderators banner. |
| Admins | **Admin Dashboard → Elections**: the on/off switch plus "Open Elections". That is the full screen, with a note that players can't see it yet, so a race can be started first. | Same, plus everything players see |

If a player reaches the screen anyway (a push link, say) while the switch is off,
they get a Coming soon page.

To flip it, go to **Admin Dashboard → Elections → "Show Staff Elections to players"**.
That needs the rules below deployed. Setting the key in the Firebase console also
works. Open apps pick up the change live. If the read is denied or the device is
offline, the app stays OFF.

---

## The roles

| | **MOD (Moderator)** | **JMD (Junior Mod)** |
|---|---|---|
| To apply | **5 squad friends** and **18+** | **3 squad friends** (Squad "Recruiter" rank) and **16+** |
| Also needed to apply | No strike or ban in the last 30 days; a date of birth on file | Same; sitting MODs can't apply for JMD |
| Who decides who is on the ballot | An admin approves each application | Same |
| Who hands out the seat | An admin, after the count (041). The vote qualifies; it does not appoint | Same |
| Term | **60 days** | **30 days** |
| Seats (default) | 4 | 6 |
| Votes needed to qualify | 10 | 3 |

### What a MOD can do
- Strike rule breakers: 12 h, then 24 h, then a permanent ban
- Mute for 5 min up to 2 h, and lift bans
- Delete rule-breaking chat messages, posts, trades, statuses and groups
- Reset an offensive profile picture
- **Give and remove Trusted, CMSR (House and Art) and Helper badges.** The player needs 3+ squad
  friends. Meeting the bar doesn't guarantee a badge; it's the MOD's call.
  A MOD an admin lists under Badge Access (below) skips the squad bar.
- Use the mod dashboard and the mod log

### What a MOD can't do
- Punish other staff (admins only, as before)
- Make MODs or JMDs (only elections do)
- Badge a player with fewer than 3 squad friends (the server rejects it),
  unless an admin put them on Badge Access

### What a JMD can do / can't do
- Can mute rule breakers for 5 min up to 2 h, and wears the JMD badge
- Can't strike, ban, unban, give badges, or mute staff
- Duties: calm chat first, pass scams and serious cases to a MOD. A good JMD
  term is the path to a MOD seat.

### Admins
- **Approve or reject applications** in Admin Dashboard → Elections (the
  Elections screen shows admins a "N applications to review" link that opens
  the tab). Each application shows the live squad count, age, account age,
  record, and the pitch. A rejection can carry a note the player sees. A
  decision can be changed while the election is open; "Remove from ballot"
  on an approved candidate is the same rejection.
- See any player's eligibility on their profile drawer (admin-only card
  above Mod Tools): squad, age, record, seat held, and any open application.
- Start or cancel an election, and remove a candidate (long-press) from the
  Elections screen. The Admin Dashboard "Elections" tab links there.
- **Decide the results (041).** Once a race is counted it appears in Admin
  Dashboard → Elections as "Results waiting for your decision" with a
  suggestion. Appoint or remove people one by one, then "Finish review".
  Nothing changes until you tap.
- Emergency removal of a MOD or JMD who abuses the role: Mod Tools → Remove Mod
  / Remove Junior Mod. The function then closes their term.
- **Appoint by hand (back since 2026-10-03).** Mod Tools → Make Mod / Make
  Junior Mod on any profile. No squad, age or record bar applies: the owner
  found the election bar kept blocking appointments. The `/users` RTDB rule
  already lets admins write the flags. A hand-appointed MOD/JMD has no
  `staff_terms` row, so no term expiry and no winner push; removing one from
  Mod Tools just clears the flag.
- **Staff Access tab** (Admin Dashboard, admin-only): delegate exactly those
  two chips to any user. The grant lives at RTDB `/jmd_granters/{uid}`
  (profile + grantedAt/grantedBy), GlobelStats live-subscribes the signed-in
  user's leaf into `canGrantJmd`, and the `/users` rule carries the matching
  carve-out for `isModerator` and `isBabyMod`. A granter who is not staff sees
  a "Staff Access" Mod Tools panel with only Make/Remove Mod and Make/Remove
  Junior Mod: no strikes, mutes, badges or deletes.
- **Badge Access tab** (Admin Dashboard, admin-only, added 2026-10-03): lets a
  MOD give Trusted, CMSR (House and Art) and Helper to players with fewer than
  3 squad friends. Same screen as Staff Access, pointed at RTDB
  `/badge_granters/{uid}`; GlobelStats live-subscribes the signed-in user's
  leaf into `canGrantBadgeAnySquad`, `canGrantBadge({ anySquad })` drops the
  bar in Mod Tools, and the `/users` rule accepts the four badge flags from a
  listed MOD whatever `/squad_size` says. It does nothing for a non-MOD: the
  rule still requires `isModerator`. Rules deployed 2026-10-03; the tab and
  chips need an app build.

---

## How an election runs

1. **Nominations, 3 days.** Anyone who meets the squad bar, the age bar and
   the clean-record rule applies with an optional 160-character pitch. The
   application is **pending** and invisible to other players.
2. **Admin review.** An admin approves or rejects each application in Admin
   Dashboard → Elections. Approved candidates appear on the ballot at once.
   Rejected applicants see "Not approved" (plus the admin's note, if any) and
   can't re-apply in that election. The admin can still decide during voting
   (the panel warns that a late approval joins the ballot late). Whatever is
   still pending when the election closes becomes **expired**.
3. **Voting, 4 days.** Each player gets one vote per race, and each phone gets one
   vote. Accounts must be 7+ days old. Nobody can vote for themselves or from the
   candidate's own phone. Only approved candidates can receive a vote. Votes can
   be changed until close. Counts stay hidden until the end.
4. **Count.** Within 30 minutes of the close, `runStaffElections` freezes each
   approved candidate's votes and marks who reached the minimum (status
   `counted`, phase "review"). Players now see the votes. Nobody is appointed.
   Every admin with a push token hears that results are waiting.
5. **Admin review (041).** Admin Dashboard → Elections shows the tally, the
   sitting team and a **suggestion**: the top `seats` qualified candidates
   (banned ones left out; ties go to the bigger squad, then to whoever applied
   first), and the holders who are not among them. The admin decides per
   player: **Appoint** (qualified, not banned now), **Remove** (a current
   holder, never an admin), or no change. Appoint and remove are final for
   that election. A JMD appointed MOD drops the JMD flag.
6. **Take office.** The admin app writes the role into RTDB at once;
   `runStaffElections` repeats the same write within 30 minutes and sends the
   winner's push. The admin taps **Finish review** to close the election.
7. **Next election.** Started by an admin, never automatically. While a race
   is under review, no new race for that role can open. When a term runs out
   with no race open, the dashboard flags it ("Terms that have run out").
8. **Nobody qualifies** (no candidates, or nobody reached the minimum): the
   election still goes to the dashboard, suggesting to keep the team. The admin
   finishes it and starts a new one when ready.

**No election replaces the team by itself.** On 2026-10-02 the hand-picked
team was 3 MODs and 2 JMDs. They can run like anyone else, and they keep their
role until an admin removes them. Existing badges (32 Trusted, 12 CMSR, 2
Helper) are kept. The 3-squad rule only applies to new grants, and removing a
badge is always allowed.

---

## Applications (040)

| State | Who sees it | What it means |
|---|---|---|
| `pending` | the applicant ("Application under review"), admins (panel + count pills) | waiting for an admin |
| `approved` | everyone: the candidate is on the ballot | can receive votes, counted at close |
| `rejected` | the applicant ("Not approved" + note) | can't re-apply in this election; a vote for them is refused |
| `expired` | the applicant | the election closed before anyone decided |

Rules enforced by `staff_run`: squad ≥ `min_squad`, `dob_age_years(date_of_birth)`
≥ `min_age` (no DOB → `age_unknown`), no strike/ban in 30 days, not banned now,
not in another open race, sitting MODs can't apply for JMD. Both bars are frozen
on the election row (`min_squad`, `min_age`) when it opens. Editing the pitch is
allowed while pending; once approved the pitch the admin saw is locked.
Withdrawing and coming back needs a fresh review (back of the tie-break too).
A banned player can't be approved even by an admin.

Age comes from `user_identity_base.date_of_birth`, which the app's mandatory
DOB gate fills and the RTDB rule makes immutable once set. On 2026-10-02,
43% of all identities had a DOB, but 89% of accounts created in the last 30
days did; older dormant accounts without one are told to add it (the app asks
at launch).

Admin RPCs: `staff_admin_applications()` (open elections, pending first, with
live squad/age/record next to the numbers frozen at entry),
`staff_admin_review(election, uid, approve, note)`,
`staff_admin_eligibility(uid)`. All three raise `42501` for non-admins; anon
has no execute grant.

## Results and decisions (041)

| Election status | Phase shown | What it means |
|---|---|---|
| `open` | upcoming / nominations / voting / counting | the race is running; "counting" = closed, waiting for the 30-minute count |
| `counted` | review | votes frozen and visible; waiting for an admin in the dashboard |
| `finalized` | finalized | the admin finished the review; `winners` = who they appointed |
| `cancelled` | — | an open race an admin cancelled (a counted one is finished, not cancelled) |

One live election per role means `open` or `counted`: `staff_admin_open`
refuses with `review_pending` until the review is finished.

`staff_decisions` holds one row per player and election: `kind` is
`appoint`, `remove` or `none`, with `decided_by`, `applied_at` (RTDB flag
written) and `notified_at` (winner push sent). `staff_admin_decide` refuses
`not_qualified` (below the bar, or not an approved candidate), `banned`,
`is_admin`, `not_holder`, `not_in_election`, and `decided` once appoint /
remove was recorded. Appoint ends the player's previous term for that role as
`reelected` and starts a new one of `term_days` from now; remove ends it as
`replaced`. `staff_admin_finish` closes the election; nothing is scheduled.

The server also keeps `staff_candidates.votes` / `qualified` frozen at the
count, so the tally does not move if votes are later purged by retention.

Admin RPCs: `staff_admin_results()` (counted elections with tally, holders,
suggestion, decisions so far, plus `termAlerts`), `staff_admin_decide(election,
uid, kind)`, `staff_admin_finish(election)`. Service role only:
`staff_pending_apply()`, `staff_decision_applied(id)`,
`staff_decision_notified(id)`, `staff_terms_open()` (active terms whose
appointment is already in RTDB, so a fresh appointment is never read as
"removed"). `staff_mark_applied` is gone.

## Where it lives

| Piece | File |
|---|---|
| Rules, voting, counting, terms | `supabase/038_staff_elections.sql` |
| Applications, admin approval, age gates, MOD bar 5, profile eligibility | `supabase/040_staff_applications.sql` |
| Count only, admin decisions, finish, review phase, term alerts | `supabase/041_staff_admin_final.sql` |
| Counts closed races, pushes admins, applies admin decisions to RTDB, pushes winners | `functions/runStaffElections.js` (every 30 min) |
| Admin: results panel (suggestion, Appoint / Remove / Finish review, term alerts) | `Code/Elections/ElectionResultsPanel.jsx`, mounted in the Admin Dashboard Elections tab |
| Apply 041 to the linked project + post-checks | `scripts/staff-elections/apply041.sh` (`--check` for read-only) |
| 041 tests | `scripts/staff-elections/test041.mjs` (PGlite), `__tests__/runStaffElections.cf.test.js`, `__tests__/staffElections.test.js` |
| Instant squad-size mirror when a friend counts | `functions/notifySquadEvent.js` |
| MOD/JMD flags: admins and `/jmd_granters` may write them; badge needs `/squad_size >= 3` unless the MOD is in `/badge_granters` | `database.rules.json` (`/users/$userId`, `/jmd_granters`, `/badge_granters`, `/squad_size`) |
| Elections screen + roles charter | `Code/Elections/ElectionsScreen.jsx`, `Code/Elections/RoleCharter.jsx` |
| Admin: applications panel (approve / reject with note) | `Code/AppHelper/AdminDashboard.js` (Elections tab; opens on `initialTab: 'elections'`) |
| Admin: eligibility card on a profile | `Code/Elections/StaffEligibilityCard.jsx`, mounted in `BottomDrawer.jsx` above Mod Tools |
| Root route so screens outside the chat stack can open the dashboard | `App.js` (`AdminPanel`) |
| Client helper | `Code/Helper/staffElections.js` |
| Entry points | Home card (only while a race is live), Squad screen card, Moderators screen banner, Admin Dashboard tab, winner push (`route: Elections`) |
| Mod Tools changes | `ProfileAdminActions.jsx`, `BottomDrawer.jsx`: Make/Remove Mod and Junior Mod chips for admins and Staff Access granters (no bar), badge chips gated on squad |
| Admin: Staff Access tab (grant / revoke `/jmd_granters`) | `Code/AppHelper/AdminDashboard.js` (`staffAccess` tab) |
| Admin: Badge Access tab (grant / revoke `/badge_granters`) | `Code/AppHelper/AdminDashboard.js` (`badgeAccess` tab, shares `ACCESS_LISTS` with Staff Access) |
| Strings | `elections.*` in all 6 languages |

**To change the rules** (seats, squad bar, minimum age, term, minimum votes,
calendar), edit `_staff_rules` in 040 and `ROLE_RULES` in `staffElections.js`
together, and the numbers quoted in `elections.coming_soon_body`,
`squad_unlock_*` and the Admin Dashboard Elections tab text. Seats
can also be changed per election from the admin stepper.

---

## Tests

- 041 SQL: `node scripts/staff-elections/test041.mjs` — 109/109 on PGlite
  (038 + 040 + 041 loaded in order, 041 twice). One race end to end: open,
  apply, approve, 46 votes, count, suggestion, every refusal reason, appoint /
  remove / none, final decisions, pending-apply and terms-open for the Cloud
  Function, finish, no auto-open, a no-winner race, term alerts, grants.
- 041 Cloud Function: `npx jest __tests__/runStaffElections.cf.test.js` —
  10/10 against an in-memory RTDB and a fake Supabase: count + admin push,
  nobody-qualified wording, appoint / remove / JMD→MOD flag, idempotent
  second run, deleted account, failed mark retried, dead token, Mod Tools
  removals, a failing count does not block decisions.
- 041 client: `__tests__/staffElections.test.js` — 22/22 (review phase, Home
  card ignores a race under review, adminResults / adminDecide / adminFinish,
  reviewSuggestion wording).
- 040 SQL: 82/82 on PGlite (eligibility matrix, apply/approve/reject/flip,
  pitch lock, withdraw-and-return, vote refusal for pending, expiry at close,
  admin-only RPCs, grants). A full flow dry run on live Postgres with
  `zz_test_*` uids was rolled back with nothing left behind.
- 040 client: `__tests__/staffElections.test.js` 19/19; i18n 9,480 renders
  of every `elections.*` key × 10 counts × 6 languages, 0 raw keys.
- 038 (unchanged): SQL: 76/76 on PGlite. A full flow dry run on live Postgres was rolled back
  with nothing left behind. It checked grants, too: anon can only read the brief,
  and finalize/due are service_role only.
- RTDB rules: 58/58 new cases in the emulator (6 of them for the switch), plus the 91/91 lockdown suite.
- Cloud Function: 13/13 against the RTDB emulator with a fake Supabase.
- Client: `__tests__/staffElections.test.js` passes 13/13.
- i18n: 2,004/2,004 key renders across 6 languages and 10 plural counts, using
  the app's real i18next.
- UI: checked on the PetCardsTest emulator with a temporary mock, which has been
  removed. Covered the Home card, Mods banner, all phases, results, team, the
  charter, entering a race, and changing a vote.

Found while building: the live `is_mod_staff()` / `is_staff()` return NULL for a
token with no email claim, so `if not is_mod_staff()` lets those accounts read
the mod log. 038 avoids it with `coalesce`. The live functions still need the fix.

---

## Deploy status

| Piece | State |
|---|---|
| Supabase `038_staff_elections.sql` | **DEPLOYED 2026-10-02**, one transaction. 4 tables, 22 functions, cron job 14. Public API checked: anon `staff_elections_brief` returns `[]`, while anon `staff_due` and `staff_elections_get` are denied. |
| Supabase `040_staff_applications.sql` | **DEPLOYED 2026-10-02** (one transaction, at the owner's request, after a rolled-back dry run on live). Additive: 5 columns, 3 new RPCs, 6 replaced; the tables were empty, so no backfill. Checked after: `_staff_rules` 5/18 and 3/16, anon has no execute on the admin RPCs or the internal helpers. |
| Supabase `041_staff_admin_final.sql` | **DEPLOYED 2026-10-02** by the owner via `scripts/staff-elections/apply041.sh` (Management API, one transaction). Post-checks passed: 24 `staff*` functions, `staff_mark_applied` gone, status check lists `counted`, `staff_elections_one_live` replaces `one_open`, `staff_decisions` with RLS, admin RPCs authenticated-only, service RPCs service-role-only, all tables still at 0 rows. |
| `runStaffElections` | **REDEPLOYED 2026-10-02** by the owner (`./functions-deploy/deploy.sh runStaffElections`, Node 20 1st gen, us-central1, successful update). This is the 041 version: count, tell the admins, apply admin decisions, push winners. Note the deploy warning: the Node.js 20 runtime is decommissioned on 2026-10-30; every function needs a runtime bump before then. |
| `notifySquadEvent` | **DEPLOYED 2026-10-02** (update). Before the deploy, live source equalled HEAD, so the only change is the `/squad_size` mirror. An unsigned call still returns 401. |
| RTDB rules | **DEPLOYED 2026-10-02** at the owner's request. Live was checked identical to the repo first, so only `users`, `squad_size` and `elections_enabled` changed. Checked after: `/elections_enabled` is public-read and denies anon writes, `/squad_size` denies reads. Squad isn't released yet, so **MODs can't give any badge** until players have 3+ squad friends. Admins still can. |
| RTDB rules, 2026-10-03 change (`/jmd_granters` carve-out for `isModerator` / `isBabyMod`, new `/links_allowed` switch) | **DEPLOYED 2026-10-03** by the owner. Live was checked identical to the repo before the edit and again after the deploy. See HANDOFF_2026-10-03_STAFF_ACCESS_LINKS.md. |
| App | Not released. The Elections screens, the results panel and the new strings are only in this working tree. 1.15.45 (171) built 2026-10-03 with the hand-appointment chips, Staff Access tab and links switch. |
| `/elections_enabled` | **ON** on 2026-10-02 (owner: for testing only). Players on today's store build see nothing either way, since their build has no Elections screens. Flip it from Admin Dashboard → Elections when the new build is out and squads have grown. |

`functions-deploy/deploy.sh` was broken for every function. Since `functions/index.js`
exists, discovery mapped each name to index.js, so the staged index required
itself and exported `undefined`. The symptom was "No function matches the filter".
It was fixed on 2026-10-02 by skipping index.js in discovery.

## Deploy order

1. ~~**Supabase 038.**~~ Done 2026-10-02. ~~**Supabase 040.**~~ Done 2026-10-02.
   ~~**Supabase 041** (admin has the final say).~~ Done 2026-10-02. Was: run
   `./scripts/staff-elections/apply041.sh` (Management API, one transaction,
   prints the post-checks), or paste the file into the SQL editor. Afterwards
   `staff_admin_results`, `staff_admin_decide`, `staff_admin_finish`,
   `staff_pending_apply`, `staff_terms_open` exist and `staff_mark_applied`
   is gone. Live was checked on 2026-10-02 before writing it: constraint
   `staff_elections_status_check` and index `staff_elections_one_open` have
   exactly the names 041 replaces, and every election table had 0 rows.
2. ~~**Functions:** `runStaffElections` and `notifySquadEvent`.~~ Done 2026-10-02.
   ~~**Redeploy `runStaffElections`** right after 041.~~ Done 2026-10-02.
   To check a run, either wait for the half-hour tick
   or fire it once with `gcloud scheduler jobs run
   firebase-schedule-runStaffElections-us-central1 --location us-central1
   --project adoptme-7b50c`, and read `firebase functions:log --project
   adoptme-7b50c --only runStaffElections`: a clean run logs nothing, or
   `squad_size: N change(s)`; an RPC name in an error means 041 is missing.
3. ~~**RTDB rules.**~~ Done 2026-10-02. These include the new `/elections_enabled` switch: public read,
   admin-only boolean write. This is a behaviour change, and it applies to every build in the field:
   - Nobody but admins can set `isModerator` / `isBabyMod` (since 2026-10-03,
     also users listed in `/jmd_granters`; deployed the same day).
   - A badge grant needs `/squad_size >= 3`.
   - Squad isn't released yet, so nobody has squad friends. Until players build
     squads, **MODs won't be able to give any badge**. Ship the rules with or
     after the Squad release.
4. **App release** with the Elections screens.
5. **First election.** While the switch is still off, an admin can start the race
   from Admin Dashboard → Elections → Open Elections. Then flip the switch on.
   An admin taps "Start MOD election" / "Start JMD election".
   Give players a few weeks after the Squad release to build squads first.
