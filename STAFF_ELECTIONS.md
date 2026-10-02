# Staff Elections: MOD and JMD

Built 2026-10-02. MODs and Junior Mods are no longer picked by hand. Players
run for a seat, everyone votes, and the winners serve a fixed term. Squad size
decides who may run. Trusted, CMSR and Helper badges are given by MODs, but only
to players with 3 or more squad friends.

---

## On/off switch ("Coming soon")

The whole feature sits behind RTDB **`/elections_enabled`**, which is **off by
default**. Only an explicit `true` turns it on.

| | Switch OFF (default) | Switch ON |
|---|---|---|
| Home | Slim "🗳️ Staff Elections · Coming soon" button. A tap shows a "coming soon, grow your squad" message. No server calls. | Same slim button with the live race ("Voting open · 2d 4h") and a chevron. It opens Elections. |
| Squad screen | "Your squad unlocks staff roles" card with a Coming soon pill. Kept so players start building squads before the first election. | The card opens Elections |
| Moderators screen | Elections banner hidden | Banner shown |
| Elections screen | Players see a Coming soon page. **Admins see everything**, with a "players can't see this yet" note, so they can start a race first. | Full screen |

To flip it, go to **Admin Dashboard → Elections → "Show Staff Elections to players"**.
That needs the rules below deployed. Setting the key in the Firebase console also
works. Open apps pick up the change live. If the read is denied or the device is
offline, the app stays OFF.

---

## The roles

| | **MOD (Moderator)** | **JMD (Junior Mod)** |
|---|---|---|
| To run | 10 squad friends (Squad "Leader" rank) | 3 squad friends (Squad "Recruiter" rank) |
| Also needed to run | No strike or ban in the last 30 days | Same; sitting MODs can't run for JMD |
| Term | **60 days** | **30 days** |
| Seats (default) | 4 | 6 |
| Votes needed to win | 10 | 3 |

### What a MOD can do
- Strike rule breakers: 12 h, then 24 h, then a permanent ban
- Mute for 5 min up to 2 h, and lift bans
- Delete rule-breaking chat messages, posts, trades, statuses and groups
- Reset an offensive profile picture
- **Give and remove Trusted, CMSR and Helper badges.** The player needs 3+ squad
  friends. Meeting the bar doesn't guarantee a badge; it's the MOD's call.
- Use the mod dashboard and the mod log

### What a MOD can't do
- Punish other staff (admins only, as before)
- Make MODs or JMDs (only elections do)
- Badge a player with fewer than 3 squad friends (the server rejects it)

### What a JMD can do / can't do
- Can mute rule breakers for 5 min up to 2 h, and wears the JMD badge
- Can't strike, ban, unban, give badges, or mute staff
- Duties: calm chat first, pass scams and serious cases to a MOD. A good JMD
  term is the path to a MOD seat.

### Admins
- Start or cancel an election, and remove a candidate (long-press) from the
  Elections screen. The Admin Dashboard "Elections" tab links there.
- Emergency removal of a MOD or JMD who abuses the role: Mod Tools → Remove Mod
  / Remove Junior Mod. The function then closes their term.
- Admins can no longer appoint by hand from the app. The old "JMD Access" tab is
  gone, and the RTDB rule no longer honours `/jmd_granters`.

---

## How an election runs

1. **Nominations, 3 days.** Anyone who meets the squad bar enters with an
   optional 160-character pitch.
2. **Voting, 4 days.** Each player gets one vote per race, and each phone gets one
   vote. Accounts must be 7+ days old. Nobody can vote for themselves or from the
   candidate's own phone. Votes can be changed until close. Counts stay hidden
   until the end.
3. **Count.** The top `seats` candidates with at least the minimum votes win.
   A tie goes to the bigger squad, then to whoever entered first.
4. **Take office.** Winners get the role, and everyone else holding that role
   loses it. Admins are never touched. A JMD elected MOD drops the JMD flag.
5. **Next election.** It is scheduled automatically to end exactly when the new
   term ends, so the cycle runs on its own once an admin starts the first one.
6. **Nobody wins** (no candidates, or nobody reached the minimum): the sitting
   team stays and a fresh election opens at once.

**The first finalized election for each role replaces the hand-picked team.**
On 2026-10-02 that team was 3 MODs and 2 JMDs. They can run like anyone else.
Existing badges (32 Trusted, 12 CMSR, 2 Helper) are kept. The 3-squad rule only
applies to new grants, and removing a badge is always allowed.

---

## Where it lives

| Piece | File |
|---|---|
| Rules, voting, counting, terms | `supabase/038_staff_elections.sql` |
| Applies results to RTDB, mirrors squad sizes, pushes winners | `functions/runStaffElections.js` (every 30 min) |
| Instant squad-size mirror when a friend counts | `functions/notifySquadEvent.js` |
| MOD/JMD elected only; badge needs `/squad_size >= 3` | `database.rules.json` (`/users/$userId`, `/squad_size`) |
| Elections screen + roles charter | `Code/Elections/ElectionsScreen.jsx`, `Code/Elections/RoleCharter.jsx` |
| Client helper | `Code/Helper/staffElections.js` |
| Entry points | Home card (only while a race is live), Squad screen card, Moderators screen banner, Admin Dashboard tab, winner push (`route: Elections`) |
| Mod Tools changes | `ProfileAdminActions.jsx`, `BottomDrawer.jsx`: no Make Mod/JMD, badge chips gated on squad |
| Strings | `elections.*` in all 6 languages |

**To change the rules** (seats, squad bar, term, minimum votes, calendar), edit
`_staff_rules` in 038 and `ROLE_RULES` in `staffElections.js` together. Seats
can also be changed per election from the admin stepper.

---

## Tests

- SQL: 76/76 on PGlite. A full flow dry run on live Postgres was rolled back
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
| `runStaffElections` | **DEPLOYED 2026-10-02** (new). Every 30 min, Node 20 1st gen, Supabase secrets attached. |
| `notifySquadEvent` | **DEPLOYED 2026-10-02** (update). Before the deploy, live source equalled HEAD, so the only change is the `/squad_size` mirror. An unsigned call still returns 401. |
| RTDB rules | **NOT deployed**, held until the Squad release (see below). |
| App | Not released |

`functions-deploy/deploy.sh` was broken for every function. Since `functions/index.js`
exists, discovery mapped each name to index.js, so the staged index required
itself and exported `undefined`. The symptom was "No function matches the filter".
It was fixed on 2026-10-02 by skipping index.js in discovery.

## Deploy order

1. ~~**Supabase 038.**~~ Done 2026-10-02.
2. ~~**Functions:** `runStaffElections` and `notifySquadEvent`.~~ Done 2026-10-02.
3. **RTDB rules.** These include the new `/elections_enabled` switch: public read,
   admin-only boolean write. This is a behaviour change, and it applies to every build in the field:
   - Nobody but admins can set `isModerator` / `isBabyMod`.
   - A badge grant needs `/squad_size >= 3`.
   - Squad isn't released yet, so nobody has squad friends. Until players build
     squads, **MODs won't be able to give any badge**. Ship the rules with or
     after the Squad release.
4. **App release** with the Elections screens.
5. **First election.** While the switch is still off, an admin can start the race
   from Admin Dashboard → Elections → Open Elections. Then flip the switch on.
   An admin taps "Start MOD election" / "Start JMD election".
   Give players a few weeks after the Squad release to build squads first.
