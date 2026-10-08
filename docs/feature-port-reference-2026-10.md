# Feature port reference — Adopt Me, October 2026

What was built in Adopt Me (adoptme-jan7) on 2026-10-07, written so the same
features can be ported to the sibling apps (Blox Fruits first; MM2 later).
Commit `6648155` holds almost all of it; the version bump, the review lock
function and the banner fix (section 1) came after.

Each section lists: what players see, how it works, every file, the server
pieces (and whether they are live for Adopt Me), and what a port has to
change. Section 9 is the Blox Fruits gap list.

---

## 1. Ads strategy

**What changed (all in `Code/Ads/`, identical `adPolicy.js` in Adopt Me, MM2
and Blox; Fisch deliberately left on its own lighter policy):**

| Setting | Value | Why |
|---|---|---|
| `COLD_START_MIN_GAP_MS` | 0 | a launch ad on every launch, not only after a long gap |
| `COLD_START_BUDGET_MS` | 5000 | the launch ad must load within 5 s |
| `LAUNCH_AD_HOME_GRACE_MS` / `LAUNCH_AD_MAX_MS` | 2000 / 7000 | it may still show briefly after Home appears, never later |
| `APP_OPEN_MIN_BACKGROUND_MS` | 10 s | return ad only after 10 s away (was longer) |
| `APP_OPEN_MIN_INTERVAL_MS` | 5 min | between app-open ads |
| `CROSS_FORMAT_GAP_MS` | 60 s | no app-open right after an interstitial |
| `NO_FILL_RETRY_MS` | 60 s | one retry after a no-fill (app-open and banners) |

- `openApp.js`: the launch ad is **not tied to the splash** any more. Splash
  hides when the app is ready; `prepareColdStart()` arms "show on first load"
  with a `LAUNCH_AD_MAX_MS` deadline; `noteHomeVisible()` (called after
  `RNBootSplash.hide`) and `noteUserTouch()` (root `onTouchStartCapture` in
  App.js) stop a late ad from jumping in once the player is using the app.
  It loads before checking the cap, retries once on no-fill, and logs
  `launch_ad` (`outcome`: shown / late / touched / no_fill / not_loaded) to
  GA via `growthAnalytics`.
- `init.js`: `canRequestAdsFromLastSession()` — the stored UMP consent
  (`AdsConsent.getConsentInfo()`, no network) plus iOS ATT already decided —
  lets ads start at once instead of waiting for the consent round-trip.
- `bannerAds.js`: `collapsible` prop → `networkExtras: { collapsible: 'bottom' }`,
  **Android only**. The owner chose it for the **main screens only** (Home tab,
  Calculator, Trade, Designs, Pet Values, Analytics, Pet Tracker, My Stuff),
  never chat. Its first load expands over half the screen, so it must NOT go
  on secondary pages (fixed 2026-10-07 after it did).
- Banner size stays the fixed 320×50 (owner decision 2026-09-20); the slot has
  no height until an ad loads.

**Bottom banner + safe area (`Code/Ads/ScreenBottomBanner.jsx`)** — for
full-screen pages (root stack, no tab bar). Android 15+/targetSdk 36 is
edge-to-edge: padding only the end of a list clears the last row but every row
scrolls behind the nav buttons. The component renders the banner (unless Pro)
and then a spacer `insets.bottom` tall in the page colour; place it as the
last child after the `flex: 1` list and drop `insets.bottom` from the list's
own padding. Props: `background`, `ad` (false = spacer only), `collapsible`.

Adopt Me pages that got it: Birthdays, Pet Cards, Card Album, Wallpaper Studio,
Trade Match, Squad, Elections, Mods, Notifications, Friends (SocialDashboard),
Badges, Leaderboard, Pet Values, Analytics; spacer only: Mystery Egg, My
Cosmetics, Settings. Pack Opening got `paddingBottom: insets.bottom` and no ad
(tap-to-reveal = accidental clicks). Card viewer modal pads both insets.
More-tab screens (hub, Wallpapers, Servers, Scammers, News) get a plain banner
via `MoreBanner` in `MoreNavigator.js` (tab bar below, no spacer).

Always-dark pages (Pet Cards set) use `Code/Helper/useDarkSystemBars.js`:
`StatusBar.pushStackEntry({ barStyle: 'light-content' })` (a plain
`setBarStyle` is overwritten by App.js's own `<StatusBar>`) and a light-icon
nav bar so Android's contrast scrim turns dark; restored on blur.

**Port:** copy `adPolicy.js` / `openApp.js` / `init.js` / `bannerAds.js`
logic, `ScreenBottomBanner.jsx`, then walk the app's root-stack screens.
Check each with `adb` on a 3-button-nav emulator.

---

## 2. Birthdays

**Players:** a Birthdays screen (More hub card + push route), a Home card
(countdown in the last week, "N players have a birthday today", or your own
party card), a 🎂 next to chat names and a birthday line in profiles, a
Settings row "Show my birthday" (on by default; hidden for under-13s) and a
one-time "Change my birthday" sheet. On your birthday: a free birthday card
pack and wishes from other players. Only month and day are ever shown.

**Data:** the date of birth already collected at first run
(`users_private/{uid}/dateOfBirth` in RTDB, mirrored to Supabase
`user_identity_base.date_of_birth`). The first-run birthday screen was already
mandatory.

**Client (`Code/Birthdays/`):**
- `birthdayDate.js` — month/day maths (29 Feb → 28 Feb in non-leap years),
  `formatMonthDay` via Intl.
- `birthdayApi.js` — Supabase RPC wrappers + MMKV cache (`birthdays` store,
  keys `home:<uid>`, `list:<uid>`; TTLs home 2 h, list 30 min, public 12 h;
  stamped with uid + local day). `birthday_home()` is the ONE call Home,
  Settings and chat badges use (~4 KB); the week list loads only when the
  Birthdays screen opens. `updateMyBirthday()` calls the HTTPS function.
- `BirthdaysScreen.jsx`, `BirthdayHomeCard.jsx`, `BirthdayVisibilityRow.jsx`,
  `EditBirthdaySheet.jsx`, `BirthdayBits.jsx` (avatar ring, 🎂, profile line,
  wish sheet), `birthdayMock.js` (__DEV__ preview, long-press the header 🎂).
- Wiring: App.js stack screen `Birthdays`; HomeTabScreen card; MoreHub card;
  Setting.jsx row; BottomDrawer profile line; MessagesList + GroupMessageList
  🎂; `navigationService` PUSH_ROUTES += 'Birthdays'; PackOpening subtitle for
  `source: 'birthday'`.
- Android gradients: a view that gains `backgroundImage` while mounted crashes
  (`LinearGradient.nativeCreate`) — give each gradient variant its own `key`.

**Server (all LIVE for Adopt Me):**
- `supabase/049_birthdays.sql` — tables `birthday_prefs`, `birthday_gifts`,
  `birthday_wishes`, `birthday_pushes`; RPCs `get_my_birthday`,
  `set_birthday_visibility`, `list_birthdays`, `get_public_birthday`,
  `send_birthday_wish`, `birthday_push_batch`; `open_card_pack` source
  `'birthday'` (ultra 70 / legendary 30, once a year, account ≥ 30 days).
- `050_birthdays_default_on.sql` — shown by default, `birthday_edits`
  (one edit per account), `_birthday_key` expression index, active-in-30-days
  filter, 200-row cap.
- `051_birthday_home_and_wish_pushes.sql` — `birthday_home()` and
  `birthday_wish_push_batch()` (first wish push + one summary 8 h later).
- Functions: `notifyBirthdays` (daily 14:00 UTC, "happy birthday / pack
  waiting"), `notifyBirthdayWishes` (every 10 min), `updateBirthday` (HTTPS,
  Bearer ID token; never into an older age group: <13 / 13–15 / 16–17 / 18+).
  **Both schedulers are PAUSED** until the app version ships — resume with
  `gcloud scheduler jobs resume firebase-schedule-<fn>-us-central1`.
- Tests: `scripts/birthdays/test049–051.mjs` (PGlite, 54 + 20 + 18 cases).

**Port:** needs the DOB already collected and mirrored to Supabase, a
`firebase_uid()` helper, `last_activity_ms`, and a gift that exists in that
app (Adopt Me's is a Pet Card pack). Translations: `birthdays` namespace.

---

## 3. More hub

The More tab is a card hub (`Code/More/MoreHubScreen.jsx` + nested stack
`MoreNavigator.js`) instead of the old top tabs. Cards: HD Wallpapers (hero),
Private Servers, Scammer DB, News, Birthdays, Complaints & ideas, Admin
(admins only). Icons are generated, not drawn by hand:
`node scripts/more-hub/make-icons.mjs` (SVG → PNG @1x/2x/3x; deterministic;
`MORE_HUB_ICONS_OUT=<dir>` to draft elsewhere). New icons this round:
`birthdays`, `reports`.

---

## 4. News (admin-written posts)

**Players:** More ▸ News is a list of posts — heading, text, "Updated <date>".
Polls, quick suggestions and the feedback box are gone.

- Data: RTDB `/news/updates/$id` `{title ≤120, body ≤5000, createdAt,
  updatedAt (server timestamps), order: -createdAt, tag: '', by}`. Old builds
  read the same list (sorted by `order`, `tag` as a chip), so new posts reach
  them too. `/news/polls` was deleted.
- Client: `Code/ValuesScreen/newsApi.js`, `News.js` (one read + pull to
  refresh, no live listener).
- Rule (LIVE): `.write` only for admins (users/{uid}/admin|isAdmin or a
  verified owner email) with field validation; tested 20/20 in the RTDB
  emulator.

---

## 5. Admin Dashboard

- **News tab** (`Code/AppHelper/AdminNewsTab.jsx`): write, edit, delete posts;
  confirms before posting.
- **Switches tab**: the app-wide switches (moderator ban & mute, links &
  emails in chat, show Staff Elections) moved off the top of every tab.
- **Chat Viewer**: once both people are picked, the two cards and two
  buttons collapse into one row (names, swap, refresh, delete).
- Tabs are admin-only where marked `adminOnly`.

---

## 6. Complaints & ideas + reports inbox

**Players:** More ▸ Complaints & ideas — Complaint (category: false review,
moderation, scam or trade, app problem, other) or Suggestion; details (≤2000);
up to 3 screenshots; sent with their user ID. "Your reports" shows Received /
Reviewed. Signed-in only, at most one a minute.

**Admins:** More ▸ Admin is now the Reports inbox (`AdminReport.js`):
Complaints / Suggestions (Open · Done · All) and "Old app" (feedback older
builds still send to `/news_feedback`). Each entry: avatar + name (tap →
profile drawer with Mod Tools), copyable user ID, category, text, images
(tap to enlarge), app version, Mark done / Reopen, Delete. Paged 40 at a time.

- Files: `Code/Reports/reportsApi.js`, `Code/Reports/ReportScreen.jsx`,
  `Code/ValuesScreen/AdminReport.js`; `Helper/modEvidenceUpload.js` gained a
  `folder` argument (`report-images/<uuid>.jpg` on the Bunny zone).
- Rules (LIVE): `/user_reports` — create-only as yourself, status 'open',
  server timestamp, images only under `report-images/`, the same write must
  stamp `/user_report_last/{uid}` (refused under 60 s, can't be deleted);
  players read only their own (query by `userId`, ≤30); admins read all,
  set open/done, delete. `/news_feedback` got a `createdAt` index and admin
  delete. 27/27 emulator cases.

---

## 7. Groups

- **Two groups per player** (`MAX_GROUPS_PER_USER = 2` in
  `ChatScreen/utils/groupUtils.js`; `getUserAdminGroups` returns a list).
  After picking players, the Create button asks "Add to <group>" / "Create a
  new group" (≤3 buttons, Android's alert limit). Client-side check only.
- **Pinned messages** (`GroupPinnedBar.jsx`): stored on the Firestore group
  doc `groups/{id}.pinnedMessages` (≤5, newest first, a snapshot: id, text,
  sender, hasImage, createdAt, pinnedBy, pinnedAt), so the existing
  `onSnapshot` delivers them live — no new table. The group's creator and
  staff pin/unpin from the long-press drawer (`MessageActionDrawer` got
  `canPin` / `isPinned`). Tapping the bar jumps to the message and steps to
  the next pin; if it isn't loaded, `loadGroupMessagesBetween()` fetches the
  gap (≤300) in one read; the list has `onScrollToIndexFailed`. Deleting a
  pinned message unpins it. Not yet tested on a device.

---

## 8. Not for porting

- `functions/guardLockedReviews.js` — locks the two reviews of one specific
  dispute (an owner decision for those reviews only). Don't copy it.

---

## 9. Blox Fruits gap list (read of `Blox_Fruit`, 2026-10-07)

Blox Fruits: branch `api53`, Android 4.0.16 (165), Firebase project
`fruiteblocks`, production with old builds in the field. Its
`database.rules.json` is GENERATED: edit
`scripts/test-rules/build-database-rules.js` and run `scripts/test-rules/test.sh`
(462 tests, JDK 21+). It has a real `firestore.rules` in the repo
(`firebase deploy --only firestore --project fruiteblocks`).

| Feature | State in Blox | Port work |
|---|---|---|
| Ads policy | The 2026-10-07 `adPolicy.js` / `openApp.js` changes are there but **uncommitted** (HEAD still has 3 s budget / 30 s away). Blox is AHEAD on consent: `openAdsGate` / `useAdsReady()`, ad-free (`proGranted`) checks, `Keyboard.dismiss()` before ads. | Commit what's there. Do **not** copy Adopt Me's `init.js` / `bannerAds.js`. Port only `ScreenBottomBanner`, adapted to Blox's `useAdsReady` / ad-free hooks. |
| Bottom banners / safe area | Only Analytics has a bottom banner among root-stack screens; most have no bottom inset (Leaderboard, Admin, Friends, Cosmetics, Mystery Egg, Badges, Guides, Notifications, Mods, Game, My Stuff, the Values stack). | Walk each screen as in Adopt Me. |
| More hub | None. The old `TopTabs.js` (Items, Codes, Scammers, HD Wallpaper, News, Analytics, Admin) is a root screen opened from a Home tile. Tabs: Home, Calculator, Stock, Trade, Designs, Chat. | Decide where the hub lives (no More tab today). `ServerScreen` (`Code/Trades/Server.js`) is dead code. |
| Birthdays | **No mandatory date of birth.** DOB is asked only on email opt-in and saved to `email_prefs/{uid}/dob`. `users_private/{uid}/dateOfBirth` has a write-once rule but nothing writes it. Supabase has `firebase_uid()`, `last_activity_ms`, `date_of_birth`; `user_identity_base` (029) is marked NOT APPLIED. No card packs. | Needs a DOB collection decision first, 029 applied (verify), a different gift (stars / cosmetic / Mystery Egg), SQL rewritten for Blox tables. Biggest port. |
| News | Old News with polls + feedback, reads `/news/updates` sorted by `order`. `/news` rule lets admins write the whole node. | New News screen + admin News tab; keep `order = -createdAt` so old builds sort right; tighten rules via the generator without breaking old builds' polls/feedback. |
| Admin Dashboard | Tabs: banned, reports, search, chatViewer, polls, statusFeed, reviewIntegrity, modLog, staffAccess. No News, no Switches; Blox has none of the three switches (no elections). | Add News tab + compact Chat Viewer. Switches tab only once Blox has switches. |
| Complaints & ideas | `AdminReport.js` (feedback + polls) exists. **`user_reports` is already a Firestore collection in Blox** (content reports, `Helper/userReports.js`). Evidence upload is server-side (`functions/modEvidenceUpload.js`), no client uploader. | Use a different path (e.g. RTDB `/player_feedback`), and the server upload path for images. |
| Groups | Same group code and the same one-group limit (`getUserAdminGroup`, `GroupsGuideModal.jsx:72` text). Firestore rules already let group admins/staff update the group doc, so pins on the doc pass. | Raise to 2 (+ guide text), add pins. Old builds keep the limit of 1 (client-only). |

**Blockers / decisions before porting to Blox**
1. Birthdays: make date of birth mandatory at first run (like Adopt Me), or
   use only players who gave it with email opt-in? And what's the birthday
   gift?
2. Where the More hub goes (Blox has no More tab).
3. Ads: commit the uncommitted Blox ad changes first.
