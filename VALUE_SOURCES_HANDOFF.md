# Adopt Me — two value sources (Elvebredd + GG)

Status: **shipped to a signed build (v1.15.33 / 159), partially verified on device.**
Last updated: 2026-09-18 · 109 tests passing · 15 files modified, 3 added

The app now carries two catalogues of Adopt Me values, the way the MM2 app
carries MM2 + Supreme. This is the whole picture: what changed, what is
deliberately unfinished, and the three things that will bite you.

---

## 1. TL;DR

| | |
|---|---|
| Elvebredd | `https://adoptme.b-cdn.net` — 3,491 items, **prices in Sharks** |
| GG | `https://adoptme-gg-values.b-cdn.net/gg.json` — **1,561** items (amvgg.com) |
| The one file that matters | `Code/Helper/valueSources.js` |
| Its tests | `__tests__/valueSources.test.js` (33 tests) |
| Data pipeline | `/Volumes/Sohail/DataFetching/adoptme` (`HANDOFF.md` there) |

```bash
npx jest __tests__/valueSources.test.js
```

**Before you touch anything here, read §3.** Almost every confusing thing about
these two feeds comes from the units.

---

## 2. What changed

| file | change |
|---|---|
| `Code/Helper/valueSources.js` | **new.** All source + unit logic, plus `categoriesFor` and `resolveItemImage`. |
| `__tests__/valueSources.test.js` | **new.** 46 tests. |
| `Code/LocalGlobelStats.js` | holds/persists `ggData` and `valueSource` |
| `Code/GlobelStats.js` | fetches both feeds; derives factors; **24h cache policy** |
| `Code/Homescreen/HomeScreen.jsx` | source-aware `getItemValue`, 3-way toggle, derived categories, stamps trades |
| `Code/ValuesScreen/ValueScreen.js` | active-source catalogue, derived categories, stamps `fruitObj` |
| `Code/HomeTab/HomeTabScreen.jsx` | "My Stuff Worth" re-priced against the active source |
| `Code/Engagement/TradeJournal.js` | same fix — it had an identical `lookupPetValue` |
| `Code/SettingScreen/PortfolioValuation.js` | mixed-source note + small-value formatting |
| `Code/Trades/Trades.jsx` | `ELV` / `GG` badge on every trade card |
| `Code/ChatScreen/**/…MessageList.jsx` (×3) | "Based on … values" under shared lists |
| `Code/ChatScreen/GroupChat/BottomDrawer.jsx` | `canManageModerator` (JMD grant work — separate feature) |
| `Code/ChatScreen/GroupChat/ProfileAdminActions.jsx` | Make/Remove Mod chip for granters |
| `database.rules.json` | JMD grant bugfix + `isModerator` carve-out — **deployed** |

`git status` should show exactly those 8 modified, plus 3 untracked
(`valueSources.js`, its test, and this file).

---

## 3. SOURCE and UNIT are two different things

This is the distinction the app was missing, and conflating them caused a real
production bug.

```
SOURCE   which site priced the item      Elvebredd | GG
UNIT     what the number is counted in   Shark | Frost
```

**Every combination is valid** *at the helper level* — `priceOf` will read GG
values in Sharks or Elvebredd values in Frosts, and that is why the two axes
are modelled separately. The old three-way `isSharkMode` (`true | false |
'GG'`) could not express that.

**The calculator UI deliberately exposes only three of the four.** One row,
three mutually exclusive pills: `Shark` (Elvebredd/Shark), `Frost`
(Elvebredd/Frost), `GG` (GG/Shark). Two lit pills read as a broken segmented
control to users, so `selectValueMode()` in `HomeScreen.jsx` sets source and
unit together and nothing else touches `setIsSharkMode`. GG is shown in Sharks
so a pet reads the same number here as on the Values screen (§8) and so none of
GG's 1,134 rows collapse toward zero — 641 of them do in native Frosts. That
last choice is one line in `selectValueMode` if it should change.

The chosen mode is remembered. `valueSource` and `valueUnit` are both persisted
in MMKV and always written together by `selectValueMode`, so the app cannot
reopen in a pair the user never picked. A user who has never touched the
control gets **Shark**, which is what the app has always opened in.

### The two sites quote in different pets

| | Shark | Frost Dragon | 1 Frost = |
|---|---|---|---|
| **elvebredd** | **1.00** ← its unit | 313 | **313 Sharks** |
| **gg** | 0.00608696 | **1.00** ← its unit | **164.29 Sharks** |

```
              Shark mode                Frost mode
elvebredd     value (native)            value / sharksPerFrost
gg            value * sharksPerFrost    value (native)
```

### The factor is DERIVED, per feed, at load time

`deriveFactor(source, rows)` reads that feed's own Shark and Frost Dragon and
computes the ratio. Called from `GlobelStats.js` whenever either catalogue
changes. It cannot go stale, and it follows a site that rebases its scale.

**The anchor is the headline `rvalue`, not a potion variant.** On Elvebredd the
Shark reads `rvalue 1 / nopotion 1 / ride 1.3 / fly 1.3 / fly&ride 1.7` —
`rvalue` puts it at exactly 1.00, which is what makes it the unit. Using
fly&ride gives 184 instead of 313. There is a test for this.

### ⚠️ The factor drifts — that is why it is derived

Elvebredd's factor has moved **28 times in two years, about once every 26
days**, climbing 142 → 313 as the Frost Dragon appreciated against the Shark.

RTDB `factor` sat at **163.94**, which was exactly right in **October 2025**
and was then never touched. 342 days later the true figure was 313, so a Frost
Dragon read **1.91 instead of 1.00** — every Frost value inflated ~1.91x. (It
is close to GG's 164.29 by coincidence, not because it came from there.)

The lesson is not that someone typed a wrong number; it is that **any stored
factor is wrong within weeks**.

Nothing reads `factor` for pricing any more. `getItemValue` still accepts it so
call sites did not have to change, and ignores it.

**RTDB `/factor` was corrected to 313 on 2026-09-17.** Current builds ignore
it; builds already in users' hands still read it, and now render Frost mode
correctly. Keep it in step with:

```bash
cd /Volumes/Sohail/DataFetching/adoptme && npm run push:factor
```

---

## 4. Precision: never `.toFixed(2)`

Use `formatValue()`. A fixed 2 decimals is right for Sharks and useless for
Frosts. Items that render as `0.00`:

| | Shark mode | Frost mode |
|---|---|---|
| elvebredd | 476 / 3,491 | **3,004 / 3,491** |
| gg | **0 / 1,134** | 641 / 1,134 |

Read that carefully: **Frost mode was already hiding 86% of the Elvebredd
catalogue in production**, long before GG existed. GG in Shark mode is the
best-behaved of the four combinations.

`formatValue()` uses significant figures — `0.00147`, not `0.00` — and takes
all four combinations to **zero lost items**. It trims trailing zeros so
ordinary Shark values stay short (`930`, `12.35`, `1,234.57`).

---

## 5. The API you will actually use

```js
import {
  VALUE_SOURCE, VALUE_UNIT, DEFAULT_VALUE_SOURCE,
  priceOf, valueOf, formatValue,
  sourceOfTrade, sourceOfItems, sourceStatement, sourceTag,
} from '../Helper/valueSources';
```

| call | for |
|---|---|
| `priceOf(item, {source, unit, valueType, isFly, isRide})` | **the one to use.** Follows the item into the active catalogue by name; returns `{value, missing}` |
| `valueOf(item, {...})` | raw read — only when the row is already from that source |
| `formatValue(n)` | rendering |
| `sourceOfTrade(trade)` | badge on a trade card |
| `sourceOfItems(items)` / `sourceStatement(src)` | chat list caption |

### ⚠️ `priceOf`, not `valueOf`, in the calculator

The calculator grid is populated from the **Elvebredd** catalogue. When GG is
the active source the row in hand still holds Elvebredd numbers, so `valueOf`
would read Elvebredd's Shark figures and convert them as though they were GG's
Frost figures — **mispricing everything by ~313x**. `priceOf` looks the item up
in the target catalogue first. This bug was written and caught during
development; do not reintroduce it.

`missing: true` means the active source does not list the item at all — 2,363
Elvebredd names are absent from GG. Say "not listed", never show `0`.

---

## 6. Cross-source matching

By **name**, normalised to lowercase alphanumerics. **Never by id** — both
catalogues number from 1 and mean different items (GG id 1 is Bat Dragon,
Elvebredd id 1 is African Wild Dog).

1,091 of GG's 1,134 names match an Elvebredd item. The 43 that do not are 36
Houses (Elvebredd has no such category) and 7 spelling differences, which the
**pipeline** already aliases when borrowing artwork — so by the time a GG row
reaches the app its `image` is an Elvebredd path and no alias table is needed
here. 1,098 of 1,134 GG rows render art for free off the existing
`https://elvebredd.com` base; the 36 Houses have none.

---

## 7. Legacy compatibility

Trades and settings saved before 2026-09 carry the three-way `isSharkMode`:

```
true   → Elvebredd, Shark      false  → Elvebredd, Frost      'GG' → GG
```

`fromLegacyMode()` / `toLegacyMode()` translate it, and new trades write
**both** `valueSource` and a legacy-shaped `isSharkMode`, so an older app build
still badges correctly. `sourceOfTrade()` falls back `valueSource` → legacy flag
→ items → Elvebredd.

A trade with none of these reads as Elvebredd, which is the honest answer: it
was the only catalogue then.

---

## 8. Design decisions worth knowing

- **ValueScreen shows both feeds in Sharks.** That list has no Shark/Frost
  toggle, and Elvebredd is already shark-native. Showing GG in its native Frost
  units would drop every number ~164x and look broken. Switching source changes
  the prices, not the order of magnitude.
- **ValueScreen shows the active source's OWN rows**, not a re-pricing of the
  Elvebredd list — so GG's 36 Houses appear and its 2,363 missing cosmetics do
  not. It falls back to Elvebredd if `ggData` has not arrived yet.
- **The two catalogues are not merged.** `localState.data` is still Elvebredd
  and 16 screens read it unchanged; `ggData` is separate. Only the calculator,
  the values list, trades and chat are source-aware.
- **The feeds are fetched with `Promise.allSettled`.** Sharing one try block
  would let a GG failure discard a good Elvebredd response — the exact bug the
  MM2 app hit when its second feed 404'd.

---

## 8b. Network cost — the 24h cache policy

The app fetches TWO catalogues now, so how often it asks matters.

```js
const VALUES_TTL_MS = 24 * 60 * 60 * 1000;
const shouldFetch = refresh || isStale || !ls.data || !ls.imgurl;
```

Three things were wrong before and are fixed in `GlobelStats.js`:

1. **The TTL was 3 minutes.** Two full downloads every few minutes per active
   user. Now 24h — values only change when the pipeline re-runs, roughly daily.
2. **The clock was the wrong variable.** It read `lastActivity`, the presence
   heartbeat (throttled to one write per 6h), not "when did I last fetch".
   `fetchDataTime` already existed in local state for exactly this and was
   never written; it is now — and only when at least one feed succeeds, so a
   failed fetch does not start the 24h clock on stale data.
3. **Cache-busting defeated the CDN.** `?cb=<ts>` + `cache: 'no-store'` on
   every request made each URL unique — no edge cache, no 304s, a full 1.2 MB
   download every time. Both are now applied ONLY on an explicit refresh.

Pull-to-refresh (`reload()` — calculator, values list, settings) always goes to
the network.

### Bunny zone config, verified 2026-09-18

| | Elvebredd | GG |
|---|---|---|
| Brotli | 1,200 KB -> **125 KB** | 1,159 KB -> **112 KB** |
| ETag | yes | yes |
| revalidation | **HTTP 304, no body** | **HTTP 304, no body** |
| `max-age` | 259200 (3d) | 2592000 (30d) ⚠️ |

GG's 30-day `max-age` is longer than the app's own TTL, so the HTTP layer can
answer from cache without contacting the network — a user who never pulls to
refresh could sit on month-old values. **Set it to 86400** so the daily fetch
revalidates and picks up changes within a day.

---

## 8c. The JMD / Moderator grant (separate feature, same files)

Not part of the value work, but it landed in the same session.

`RTDB /jmd_granters/{uid}` delegates staff powers to a non-staff user. As of
2026-09-17 a granter can make **both** Junior Mods and **Moderators**.

**A bug this uncovered:** the dashboard writes an *object* to that node
(`{displayName, grantedAt, …}`) while the rule tested `.val() === true`. An
object is not `true`, so **every grant ever issued was silently denied by the
server** — the chip appeared and the write failed. The rule now tests
`.exists()`, which matches what the client reads and what revoke writes
(`set(…, null)`).

`database.rules.json` is **deployed**. A granter sees exactly two chips under a
"Staff Access" header — Make/Remove Mod, Make/Remove Junior Mod — and nothing
else: no strikes, mute, unban, badges, delete, or dashboard tabs.

⚠️ This is a real escalation: the Moderators they create get strikes, mute,
badges and Chat Viewer, none of which the granter holds. Revoke from the JMD
Access tab. Two users currently hold it.

---

## 9. NOT DONE — read before shipping

1. **Only partly verified on device.** Confirmed working on the emulator: the
   3-way toggle (GG Bat Dragon 492.86 vs Elvebredd 943), the trade `ELV` badge
   on real trades, and "My Stuff Worth" re-pricing. **Never eyeballed:** the
   chat caption, the Settings portfolio note, and the drawer's category list /
   image fallback in GG mode.

2. **Smoke-test the release bundle.** R8 runs in full mode with optimisation
   (`proguard-android-optimize.txt`, `android.enableR8.fullMode=true`), which is
   the configuration most likely to surface a missing keep rule — and none of it
   runs in a debug build. Test Google Sign-In especially; R8 logs 32 warnings
   about malformed stack map tables in Google's own `play-services-auth` jar.
   Harmless today, but a future AGP bump may strip those methods.

3. **No GG diff zone.** `analyticsDataHelper.js` reads
   `check-diff-adoptme.b-cdn.net/diff.json` regardless of the active source, so
   hot badges always describe the Elvebredd catalogue. The pipeline already
   builds `dist/gg/diff.json`; it needs a zone and a source-aware URL.

4. **⚠️ The hot badge is inverted — pre-existing, not from this work.**
   `analyticsDataHelper.js` flags an item hot when `score.newVal >
   score.oldVal`. But `score` is a rank where **1 is best**, so a rising number
   means the item got **less** valuable. Verified: of 30 diff entries where
   both `score` and a value changed, **30/30** moved in opposite directions.
   One character (`>` -> `<`).

5. **`App.test.tsx` fails** — pre-existing, a `@react-navigation` transform
   issue in `App.js`, untouched by this work. The other suites pass.

6. **This repo has parallel sessions editing it.** ~19 files unrelated to the
   value work (`AdminDashboard.js`, `functions/index.js`, the moderation files)
   were modified alongside these, and some of my HomeScreen edits were rewritten
   mid-session. Filter with `grep -rln valueSources Code` before attributing
   anything, and re-read a file immediately before editing it.

7. **Keystore credentials are committed.** `android/app/build.gradle` holds
   `storePassword` / `keyPassword` in plain text next to `solanalab.keystore`.
   Anyone with repo access can sign as you. Moving both to
   `~/.gradle/gradle.properties` fixes it without changing the build.

---

## 10. Where the data comes from

`/Volumes/Sohail/DataFetching/adoptme` — `HANDOFF.md` there is current.

```bash
cd /Volumes/Sohail/DataFetching/adoptme && npm run all
```

Scrapes both sites, verifies, proves the two JSON files are structurally
interchangeable, derives the factors, and builds `dist/` for upload. ~1 minute.

The pipeline guarantees `gg.json` is a **drop-in** for `data.json` — same field
names, same key order, same types, same diff shape — and `npm run parity` fails
the build if that ever drifts. Anything you add here that reads one feed will
read the other.
