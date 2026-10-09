# Adopt Me — work log, 2026-10-08

Everything changed in this session, what is live, and what to port to Blox Fruits.
All app code is **uncommitted** in `adoptme-jan7`. Port status per item is at the end.

## 1. Birthdays — speed, loading, one-tap wishes, paging

**Problem:** Home → Birthdays was slow; the screen showed "No birthdays" before data arrived; wishing needed a drawer with 4 messages.

- `Code/Birthdays/BirthdaysScreen.jsx` rewritten:
  - ScrollView of up to 200 rows → **FlatList** with memoized `BirthdayRow` (worst frame on open 250 ms → 65 ms in debug).
  - **Skeleton placeholders** (pulsing rows, native driver) while loading, instead of "none today".
  - **One-tap wish**: button sends template `hbd`, shows a spinner on that row only; many wishes can be in flight at once (`pendingRef` Set). No success toast; row turns into "Sent". `already_wished` marks it sent; new `err.limit` for the 50/day cap.
  - **Today + tomorrow only, 20 per page, "Load more"**; section counts ("Today · 32").
  - Error state with Retry.
- `Code/Birthdays/birthdayApi.js`: paged list cache (`page:<uid>`, 30 min), `loadMoreBirthdays()`, generation counter drops late pages, falls back to `list_birthdays(1)` paged on the phone when the new RPC is missing. `emit()` only when the Home data changes.
- `Code/Birthdays/BirthdayBits.jsx`: WishSheet removed; **chat `BirthdayCake` re-renders only when its own uid's status changes** (was: every chat row on every refresh).
- `Code/Birthdays/birthdayMock.js`: 24 extra sample players + `list_birthdays_page` for dev preview.
- **SQL `supabase/052_birthday_list_paged.sql` — APPLIED.** `list_birthdays_page(p_local_date, p_days, p_limit, p_cursor)`: phone's date (clamped UTC±1), keyset paging, `counts` on page 1, wish counts for the page only. Test: `node scripts/birthdays/test052.mjs` 30/30.
- Strings (7 locales): added `none_tomorrow`, `load_more`, `retry`, `err.limit`; removed `this_week`, `none_week`, `wish_title`, `wish_sub`, `wish_sent_title`, `wish_sent`.

## 2. Home card art (kid-friendly, tiny)

- `Code/HomeTab/HomeCardArt.jsx`: white disc + art, used by Birthdays (cake / balloons / gift), **Trade Match** (heart in swap arrows), **Squad** (three blob friends).
- Art is generated: `node scripts/home-cards/make-art.mjs` → `assets/home-cards/*.png` (56 pt, @2x/@3x, ~1–4 KB each). Style: chunky shapes, cute face, two-tone shading, no outlines.

## 3. More tab — performance, leaks, bugs

- `Code/More/MoreNavigator.js`: screens are module-level `component=`s + `MoreThemeContext` (inline render callbacks bypassed StaticContainer → every parent render re-rendered every screen).
- `Code/GlobelStats.js`: `isAdmin`, `single_offer_wall` added to `contextValue` deps.
- `Code/ValuesScreen/HDwallpaper.js`: `resizeMethod="resize"` (full 1080×1920 decodes), memo `WallpaperCard` with own load state, Load more guarded (ref + 400 ms cooldown, no timers in state updaters), likes/dislikes via `increment(±1)` per field, own reaction saved in MMKV `wallpaper_reactions`.
- `Code/ValuesScreen/ScammerDatabaseScreen.js`: stale detail responses dropped (showed A's report under B), **all reports for a name shown** (reports 2..n were invisible; read via `reportedUsername_lc`), admin delete removes all, request-id race guards, loading spinner, Modal `onRequestClose`, `atob` instead of a JS base64 loop, search/submit in-flight guards.
- `Code/ValuesScreen/ServerScreen.js`: pull-to-refresh + retry, no raw Firebase error text.
- `Code/Reports/ReportScreen.jsx`: double-send ref guard.
- `Code/ValuesScreen/AdminReport.js`: memo cards; profile drawer mounted only while open.

## 4. Trade Match — "Want my pets" (player request)

- **SQL `supabase/053_trade_match_wanters.sql` — APPLIED.** `find_pet_wanters(p_limit)` + GIN index on `want_keys`. Test: `node scripts/trade-match/test053.mjs` 26/26.
- `Code/Helper/tradeMatch.js`: `fetchPetWanters()` (10 min cache, cleared on sync).
- `Code/TradeMatch/TradeMatchScreen.jsx`: tabs "Have what I want | Want my pets"; `WanterCard` (their dream = your pet first, "Wants from you", "Could give you", +N more). Loads only when the tab opens and the player has For Trade pets.

## 5. Pet Cards — choosing a pack

- `Code/PetCards/PetCardsScreen.jsx`: last chosen pack remembered (`cardsApi.getLastPackSet/rememberPackSet`, MMKV `pack:<uid>`), "Choose your pack" label, bigger emoji chips, ‹ › arrows.

## 6. My Stuff — filters, multi-select, undo

`Code/Engagement/TradeJournal.js` (My Pets tab):
- **Filters** panel: Status (For Trade/Private), Variant (Neon/Mega/Fly/Ride), Type, Rarity; only options the inventory has, with counts; "Showing X of Y · Clear filters".
- **Long-press** a pet to start selecting; "All (N)" selects what is shown after search+filters; "Select none"; bulk For Trade / Private / Remove.
- **Remove without confirm dialogs** + "Removed N pets · UNDO" bar (8 s, removals add up).
- Grid → FlatList (3 columns) with memo `OwnedPetCard`; `valueIndex` Map instead of `find()` over ~3,500 items per pet.

## 7. "Trade in game" in DMs — ADOPT ME ONLY (do not port)

Template `trade_server`, pinned "🎮 Trade in game · Invite · Join ›" line in the chat safety strip, `Code/Helper/tradingServer.js`, SQL `054` (applied). Owner asked to keep this out of Blox Fruits.

## 8. Birthday email (Brevo)

- Brevo (free plan, 300/day shared) account sohailnasir74business@gmail.com. Domain `adoptmevalues.app` **authenticated**; sender `Adopt Me Values <hello@adoptmevalues.app>` verified. API IP blocking must stay **off**. Secrets: `BREVO_API_KEY` (v2), `EMAIL_UNSUB_SECRET`.
- `functions/birthdayEmail.js` (7-language copy, HTML + plain variant, signed unsubscribe links, Brevo send), `functions/notifyBirthdayEmails.js` (daily 08:00 UTC, ≤250/run, 13+, skips optIn=false / no email / Apple relay), `functions/emailUnsubscribe.js` (confirm page; POST + RFC 8058 one-click set `email_prefs/{uid}.optIn=false`).
- SQL `supabase/055_birthday_emails.sql` (claims today's 13+ birthdays once a year) — **APPLIED** (cleanup cron job id 16). Test `test055.mjs` 11/11; `scripts/birthdays/testBirthdayEmail.js` 61/61; test email delivered (Promotions tab).
- **Deployed** `notifyBirthdayEmails` + `emailUnsubscribe` (adoptme-7b50c); scheduler `firebase-schedule-notifyBirthdayEmails-us-central1` **PAUSED** (resume when the app build ships). Unsubscribe page verified live. Daily cap 150 (Brevo 300/day shared with Blox 120).
- Email button opens `adoptmevalues.app/app` (store buttons); real app links (assetlinks/AASA + intent filters) not set up yet.

## 9. Other

- Poll draft for the "Trade in game" idea (owner posts from Admin → Polls).
- Russian quick-message phrases: separate session.
- `docs/brevo-email-sample.png`, `docs/birthday-email-preview.png`.

## Port to Blox Fruits (everything except §7) — done 2026-10-08, uncommitted on Blox `api53`

| # | Item | Blox |
|---|---|---|
| 1 | Birthdays paging / skeleton / one-tap / chat cake | Ported by 3-way merge (Blox keeps its 15⭐ gift + known-DOB logic). SQL `supabase/037_birthday_list_paged.sql` (test037 30/30) — **owner applies** |
| 2 | Home card art | `Code/HomeTab/HomeCardArt.jsx` + cake/balloons/gift only (no Trade Match/Squad in Blox) |
| 3 | More tab fixes | MoreNavigator, HDwallpaper, ScammerDatabaseScreen (+ fixed a missing `t()` crash), AdminReport, ReportScreen. No ServerScreen in Blox |
| 4 | Trade Match "Want my pets" | Not applicable (Blox has no Trade Match) |
| 5 | Pack chooser | Not applicable (Blox has no Pet Cards) |
| 6 | My Stuff | TradeJournal: Type + Rarity filters, search, sort, long-press select, undo, valueIndex, memo card |
| 8 | Birthday email | `functions/birthdayEmail.js` (English, 15⭐ gift), `notifyBirthdayEmails` (09:00 UTC, cap 120), `emailUnsubscribe`; SQL `038_birthday_emails.sql` (test038 11/11); test 25/25. **Needs:** bloxfruitscalc.com authenticated in Brevo + sender hello@bloxfruitscalc.com, secrets on fruiteblocks, SQL 038, deploy paused |

**Owner decision (2026-10-08): the Blox birthday email goes live only AFTER the Adopt Me email proves successful.** The Blox code + SQL 038 stay ready but are NOT set up (no Brevo domain for bloxfruitscalc.com, no fruiteblocks secrets, no 038, no deploy) until then.

Strings: 58 keys verified in all 11 Blox locales (birthdays + `trade_journal.my_fruits.*`). All Blox files compile under Hermes. Not yet run on a device.

## Builds uploaded (Play INTERNAL testing, 2026-10-08)

- **Adopt Me 1.15.53 (179)** — AAB 70.4 MB, with R8 mapping. Next versionCode 180.
- **Blox Fruits 4.0.18 (167)** — AAB 56.6 MB. Next versionCode 168.
- Built from the uncommitted working trees; owner tests on internal. Birthday push/email schedulers stay paused (owner switches them on).

## 10. Pet Cards — performance + flashes (after the builds; uncommitted)

The owner said the card screens felt heavy and flashed when entering, switching and going back. Measured on the emulator (debug build) with screen-recording frames and `dumpsys gfxinfo`. Nothing in the looks or behaviour changed; the old and new album were pixel-diffed (0 differing pixels, classic and holo/foil cards).

| Scenario (debug build) | Before | After |
|---|---|---|
| Open "All Pets" album: frames in 3.4 s / p90 / worst | ~30 / 400–450 ms / 750–1,100 ms | ~115 / ~100 ms / 150 ms |
| Switch album set: frames / p50 | 12–13 / 250–300 ms | 90–110 / ~30 ms |
| Pack switch on the hub | white nav-bar frame each switch | none |

- **Album cost = tiled textures.** Android draws `resizeMode="repeat"` by painting a new, uncached bitmap per image view; each card had 1–3. The thumbnails now use pre-tiled sheets: `assets/pet-cards/*_sheet.webp` (lossless, 15–50 KB each), made by `scripts/pet-cards/make-texture-sheets.py`. `PetCard.jsx` `Texture` uses a sheet when the area fits (Android only) and otherwise keeps repeat (full-size cards, iOS).
- **Album list:** builds one row per 100 ms until the first drag, then the old 9 cards per 50 ms, so a fast fling never outruns it (`CardAlbumScreen.jsx`).
- **Flashes:**
  - `Helper/useDarkSystemBars.js`: a colour change no longer runs the blur clean-up; hand-back waits 150 ms so dark → dark screens never show the light bar.
  - `CardViewerModal.jsx`: no longer a `<Modal>` (a separate window that got a light nav bar); now an in-screen overlay with the same fade, Back closes it.
- **First paint complete:**
  - `usePetCards.js` starts from cached state, catalogue and collection. `cardsApi.js` adds `peekCatalog`/`peekCollection`; the own collection is also kept in MMKV `col:<uid>`, and a pack marks it stale instead of dropping it. No more "0 of 0" → "0 of 579" → "3 of 579".
  - `Engagement/useStarBalance.js` remembers the last balance per uid.
  - The value index is built once per values list (it was per screen).
- **Less work per focus:**
  - `cardMath.setProgressAll` (one pass for all sets; same results as `setProgress`, checked on 356 cards × 24 sets) and a `byKey` lookup for the showcase.
  - `cardArt.loadArtManifest` re-downloaded 3 lists on every focus (`v1/index.json` 404s), so it is now throttled to 10 min (6 h when all three load).
- All changed files compile under Hermes.
