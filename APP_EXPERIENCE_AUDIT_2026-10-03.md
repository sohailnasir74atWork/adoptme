# Adopt Me Values: install-to-daily-use experience audit (2026-10-03)

**Scope.** How the shipped app behaves from install → cold start → first screen → everyday use (scrolling, chatting, trading), with performance and UX suggestions. Static review of the working tree on `bump-android-138` (uncommitted work included), a release JS bundle built from it, and live Crashlytics for 2026-09-25 → 2026-10-02 (Android 1.15.39 build 165, iOS 11.9 build 114). Nothing was changed in the app; no device timings were measured, so "fast/slow" below comes from code paths plus the app's own `startup_ready` logs found in crash samples.

## Verdict

The foundation is in good shape and most of the obvious cold-start work has already been done: Hermes bytecode, New Architecture, R8 full-mode, root screens loaded on first navigation, ads/consent/update checks pushed to idle, a 3 s splash cap, login reads fanned out in parallel with 10 s timeouts. In the two crash samples that carried timings, the app was interactive 2.1 s after tap on an iPhone 13 and 4.7 s on a low-end Realme.

What holds the experience back today, in order of user impact:

1. **Stability on the current store builds.** The iOS crash that hit 188 users on 11.9 turned out to be a two-hour Google backend incident on 2026-09-29 (resolved upstream, no events since). Android 1.15.40 crashed on launch for everyone who got it (already fixed in the tree, not yet shipped).
2. **The first session is prompt-heavy.** A signed-in iOS user in the EEA can see up to seven overlays/dialogs before using the app, two of which can draw on top of each other.
3. **The update checker is more aggressive than it needs to be.** On iOS it opens the App Store on every launch while a newer version exists; on Android it forces an immediate blocking update.
4. **The two root contexts re-render the whole app** on things like presence flips, and a handful of hot list rows (community chat, trades, feed) do heavy work on every render.
5. **A few startup costs remain** that are cheap to remove. The biggest is a hydration race that makes the app re-download and re-parse both 1.2 MB pet catalogues on **every** launch despite a 24 h cache; the rest are an eagerly bundled Russian translation, 14 Lottie files loaded for one, dead cache keys parsed every launch, and all tab modules evaluated before first paint.

## Key numbers

| What | Value | Why it matters |
|---|---|---|
| Shipped JS bundle (Hermes bytecode) | 8.8 MB | Parse is cheap with bytecode; module *evaluation* still costs. |
| Mapped source: app code / dependencies | 1.9 MB / 3.5 MB | Biggest dep is RevenueCat's web mappings at 730 KB, larger than react-native itself. |
| Translations in bundle | 1.25 MB (6 files); en + ru evaluated at start (418 KB) | ru is eager despite the "only English" comment. |
| Android AAB (4 ABIs) | 69 MB | Play delivers per-ABI; fine. |
| Android 1.15.39, 7 days | 10,021 users, 98.8 % crash-free sessions | Healthy, but see the 1.15.40 launch crash. |
| iOS 11.9, 7 days | 8,576 users; 188 users hit one new native crash | 2.2 % of iOS users, one crash each. |
| Launch-path non-fatals, 7 days | 290 Android users "login reads unreachable"; 148 iOS users "signed out at launch" | The login fan-out is fragile on poor networks. |

## 1. Stability on the current versions

**iOS 11.9: `NSInvalidArgumentException … setObject:forKeyedSubscript: key cannot be nil` (Crashlytics issue 181010225a8f…). Resolved upstream, not an app bug.** 188 users, one crash each. Triaged 2026-10-03: every listed event falls between 01:35 and 02:47 UTC on 2026-09-29 and none since. That is the window of a Google backend incident: Firebase Analytics (GoogleAppMeasurement) served a malformed `sdk-exp` experiment payload from 00:41 to 02:47 UTC and `GULMutableDictionary` crashed on the nil key in every iOS app on Firebase 12.x worldwide ([firebase-ios-sdk #16728](https://github.com/firebase/firebase-ios-sdk/issues/16728), [#16737](https://github.com/firebase/firebase-ios-sdk/issues/16737), [GoogleUtilities #248](https://github.com/google/GoogleUtilities/issues/248)). It was fixed server-side; no app release was needed, and "first seen in 11.9" only means 11.9 was the live build that night. Optional hardening: bump GoogleUtilities from 8.1.3 to 8.1.4, which Google released to tolerate bad server data. Watch: a new event on this issue after 2026-09-29 03:00 UTC would be a different bug.

**Android 1.15.40: crash before any JS runs.** `androidx.startup` → WorkManager → Room could not instantiate `WorkDatabase_Impl` because R8 full-mode stripped the constructor; 100 % of that build's users crashed (4 times each) in the first second. The keep rule is already in [android/app/proguard-rules.pro:64](android/app/proguard-rules.pro:64) and the issue has not appeared on 1.15.41/42. Action: before every rollout, install the **release** AAB on a device and open the app once. R8 optimisation plus reflection is exactly the failure class that only a release build shows.

**Android ANR `nativePollOnce` (48 users/week) and two Google Mobile Ads WebView crashes (`child already has a parent` 26 users, `Bitmap.getWidth` on null 18 users).** All three occur right after an `AdActivity`, inside the ads dynamite module, with no app frames. Nothing to fix in JS; keep the GMA SDK current and watch whether 16.x reduces them.

**Launch-path sign-in drops.** `auth_login_reads_unreachable` (290 Android users) and `auth_signed_out reason=native-null` (148 iOS users) are the app's own instrumentation of users whose profile reads failed or whose session vanished at launch. The current tree already caps the wait at 3 s and lets them in with a minimal profile, but the volume says "signed-in UI" should not depend on the network at all. Suggestion: persist the last full profile in MMKV, render from it immediately, and reconcile in the background (the `reloadProfileWhenConnected` machinery in [Code/GlobelStats.js](Code/GlobelStats.js) already does the reconcile half).

## 2. Cold start → first usable screen

What is already right: `index.js` lazy-requires the React tree so headless pushes stay cheap; root stack screens use `getComponent`; the 2.3 MB pet catalogues parse on idle; interstitial/rewarded/update/RevenueCat/consent are idle-deferred; the splash can never strand (`finally` + 3 s cap).

Findings, most impactful first:

- **Login reads start only when the JS thread goes idle** ([Code/GlobelStats.js:771](Code/GlobelStats.js:771) wraps `handleUserLogin` in `requestIdleCallback`). On slow devices the busy first render burns 1–2 s of the 3 s cap, the cap trips, and a signed-in user sees a Lv.1 / signed-out flash. Fire the 13 network reads immediately in the auth callback; defer only the `setUser` application.
- **Ad SDK + consent initialise in the very first effect on every non-Pro launch**, even when no cold-start ad is eligible ([App.js:476](App.js:476) → `AppOpenAdManager.start()` → [Code/Ads/init.js:45](Code/Ads/init.js:45)). Android `initialize()` does main-thread WebView work. When `prepareColdStart` is ineligible (most launches within 4 h), run `ensureAdsInitialized()` after the splash hides. When it *is* eligible, kick it from `prepareColdStart` so the ad request is not serialised behind consent and the 3 s hold actually pays off on slow networks.
- **Every tab's module graph is evaluated before first paint.** [Code/AppHelper/MainTabs.js:6-18](Code/AppHelper/MainTabs.js:6) statically imports HomeScreen (3,128 lines), ValueScreen (2,046), ChatStack, TradeStack, DesignStack and an unused `DesignUploader`. `lazy: true` defers mounting, not evaluation. Inline-`require` inside each tab's render callback, as App.js already does for the root stack.
- **Russian is bundled and evaluated eagerly** ([i18n.js:15](i18n.js:15), 243 KB) although the comment says English only; es/fr/de/ar are lazy. Move `ru` into the lazy switch.
- **14 level Lottie JSONs (622 KB) are required at module scope in the Home tab** ([Code/HomeTab/HomeTabScreen.jsx:43-58](Code/HomeTab/HomeTabScreen.jsx:43)) and the one shown loops forever, including while the user is on Chat or Trades ([HomeTabScreen.jsx:415](Code/HomeTab/HomeTabScreen.jsx:415)). Require only the current level; pause on blur (`useIsFocused` or `freezeOnBlur`).
- **Dead MMKV keys are JSON-parsed synchronously every launch**: `codes`, `normalStock`, `mirageStock`, `prenormalStock`, `premirageStock`, `postsCache` ([Code/LocalGlobelStats.js:60-64,101](Code/LocalGlobelStats.js:60)) have no writer left in `Code/`. Drop them and `storage.remove()` once.
- **Duplicate network at Home mount**: `syncMyCosmetics` runs from both [MainTabs.js:59](Code/AppHelper/MainTabs.js:59) and [HomeTabScreen.jsx:158](Code/HomeTab/HomeTabScreen.jsx:158); the `user_profiles` `getDoc` runs in the mount effect and again in `useFocusEffect`.
- **Realistic worst case for a returning non-Pro user on a slow network**: ~1–1.5 s native → 3 s splash hold → Home at ~4.5 s with the profile still filling in; if the App Open ad does land, add its dwell for ~9–10 s to content. The hold is paid whether or not the ad arrives.
- **Verify, not confirmed**: [Code/Supabase/client.js:16](Code/Supabase/client.js:16) says RN Firebase emits `onAuthStateChanged(null)` first on cold start. If so, `handleUserLogin(null)` runs and `isAppReady` opens the splash before the real user is restored. The sign-in drawer's "restoring" state hides this, but the `startup_ready` Analytics distribution will tell you whether the gate is doing anything.

## 3. The first session: prompts and gates

Sequence a brand-new, signed-in iOS user can hit (from the code paths):

1. Splash (≤ 3 s), no cold-start ad on first launch.
2. Onboarding (welcome → sign in / guest).
3. Sign-in drawer → success toast → **system push-permission dialog** immediately ([Code/Firebase/SigninDrawer.jsx:232,330,370](Code/Firebase/SigninDrawer.jsx:232)), and again on every launch via `handleUserLogin` → [Code/Globelhelper.js:94](Code/Globelhelper.js:94).
4. On idle: **ATT primer** → **Apple ATT dialog** → **UMP consent form** (EEA).
5. **DOB gate**, which can render at the same time as the ATT primer (both are `zIndex: 9999` overlays with no mutual gating: [App.js:99,415-439](App.js:99), [Code/AppHelper/DateOfBirthModal.js:291](Code/AppHelper/DateOfBirthModal.js:291), [Code/AppHelper/AttPrimer.jsx:62](Code/AppHelper/AttPrimer.jsx:62)). Only the email gate is blocked by `attPrimerVisible`.
6. Email opt-in (silent if ticked, prompt after 20 s otherwise).
7. First background→foreground: App Open ad; launch 6: in-app review at mount.

Specific suggestions:

- **Cap the update checker.** [Code/AppHelper/InAppUpdateChecker.js](Code/AppHelper/InAppUpdateChecker.js) has no frequency limit: on iOS it calls `Linking.openURL` to the App Store on **every cold start** while the store version is newer (which, with App Store review lag and phased release, is days after each release); on Android it uses `IAUUpdateKind.IMMEDIATE`, a full-screen blocking flow. Use FLEXIBLE on Android, prompt at most once per 24 h and once per store version on iOS, and keep IMMEDIATE/forced for a remote "minimum supported version" flag.
- **Sequence the overlays.** Pass `blocked={attPrimerVisible}` into the DOB gate (or run DOB after `handleUserConsent` resolves) so no two full-screen prompts share the screen.
- **Ask for push at a value moment** (first trade posted, Notifier opt-in, Settings), not inside the sign-in drawer and not on every launch. Keep `handleUserLogin` to token refresh when the status is already determined.
- **Move the in-app review** off app mount (launch 6 coincides with the cold-start ad) to after a success moment, with the existing 24 h cooldown.
- **Add a cross-format ad cooldown.** App Open (2 min, its own cap) and interstitial (30 s, its own cap) do not know about each other, so a cold-start ad can be followed within seconds by the interstitial that fires unconditionally on the first Codes-drawer open ([Code/ValuesScreen/ValueScreen.js:919](Code/ValuesScreen/ValueScreen.js:919)). Share one `lastFullScreenAdAt` in `adVisibility.js` and **defer** (never skip) when under ~45 s, so no impression is lost.
- **Standing policy risk (owner's call, noted for completeness):** DM screens still carry a banner and two interstitial triggers ([Code/ChatScreen/PrivateChat/PrivateChat.jsx:1307,458](Code/ChatScreen/PrivateChat/PrivateChat.jsx:1307), [PrivateMessageInput.jsx:344](Code/ChatScreen/PrivateChat/PrivateMessageInput.jsx:344)). AdMob's "ads in private communications" policy already put the sibling Blox Fruit app under restricted serving for this. If it is ever enforced here, every impression app-wide is affected, not just chat.

## 4. Everyday use: scrolling, typing, re-renders

Already right: inverted chat lists paginate by appending to the tail (no scroll jump); message lists and avatar components are memoised; the pet album uses `getItemLayout`; animations use the native driver except where they cannot; avatars are compressed to 300 px before upload; no per-keystroke network writes anywhere.

Findings, most impactful first:

- **Community chat: every keystroke re-renders every mounted message row.** The composer's `input` state lives in [Code/ChatScreen/GroupChat/Trader.jsx:95](Code/ChatScreen/GroupChat/Trader.jsx:95), and `onReply` is an inline arrow at [Trader.jsx:1245](Code/ChatScreen/GroupChat/Trader.jsx:1245) that sits in `renderMessage`'s deps at [MessagesList.jsx:664](Code/ChatScreen/GroupChat/MessagesList.jsx:664). Each keystroke → new `onReply` → memo defeated → FlatList re-renders ~21 viewports of rows. Keep `input` inside `MessageInput` (as the group and private inputs already do) and `useCallback` the handler.
- **Full ornate SVG avatars at 28 px in chat rows.** `forceDetail` at [MessagesList.jsx:376-382](Code/ChatScreen/GroupChat/MessagesList.jsx:376) and [GroupMessageList.jsx:230-236](Code/ChatScreen/GroupChat/GroupMessageList.jsx:230) bypasses the level-of-detail threshold in `FramedAvatar` that exists for lists, so each row builds defs, gradients, clip paths and decorations and rasterises the avatar inside the SVG. Drop `forceDetail` in rows; keep it for the Home header.
- **Trades rows are an unmemoised closure doing heavy work per render** ([Code/Trades/Trades.jsx:1645](Code/Trades/Trades.jsx:1645)): `dayjs().fromNow()`, `groupItems` twice, two profile-cache reads (MMKV + `JSON.parse` each), an SVG avatar, and the 2,954-line screen re-renders on every `onScroll` via `setIsAtTop`. Extract a `React.memo(TradeRow)` with primitive props; stamp `timeAgo` at fetch time.
- **The `user` object's identity churns on every presence flip**, re-rendering all 79 `useGlobalState` consumers ([GlobelStats.js:1381](Code/GlobelStats.js:1381) always spreads a new object even when `online` is unchanged). Guard with `prev.online === val ? prev : {...}`. Beyond that, the cheapest structural win is splitting the global context into Theme / User / Static (db handles, stable callbacks) / Catalog (`data`, `ggData`, `imgurl`) / Prefs, which removes nearly all tree-wide re-renders without a new library.
- **`localState` holds the 1.2 MB catalogue next to every flag**, so writes like `isAppReady`, `lastActivity`, `isPro`, `bannedUsers` re-render all 47 `useLocalState` consumers and the 1,554-line global provider. The catalogue is also `JSON.stringify`'d to MMKV twice on save ([LocalGlobelStats.js:201](Code/LocalGlobelStats.js:201) inline and again in the deferred effect at [:160](Code/LocalGlobelStats.js:160)). Skip the inline write for `data`/`ggData`.
- **Memoised feed/poll rows subscribe to the global context inside their memo** ([Code/Design/componenets/PostCard.js:76](Code/Design/componenets/PostCard.js:76), [PollCard.jsx:43](Code/Trades/PollCard.jsx:43)), so every global tick re-renders every mounted card past the comparator. Pass `theme`, `isAdmin`, `userId` as props.
- **Feed keys include the index and the ad interleave runs un-memoised** ([Code/Design/DesignMainScreen.js:734-744](Code/Design/DesignMainScreen.js:734)): any prepend or ban filter shifts keys and remounts PostCards. Key by id; `useMemo` the interleave.
- **Profile cache parses on every read** ([Code/Helper/profileCache.js:51-66](Code/Helper/profileCache.js:51)), twice per row per render in both chat lists and online users. Put an in-memory `Map` in front of MMKV.
- **Chat `windowSize={21}`** with clipping deliberately off ([MessagesList.jsx:688](Code/ChatScreen/GroupChat/MessagesList.jsx:688)) keeps ~10 viewports of heavy rows mounted each way; 7–9 is enough.
- **Images**: chat photos under 1 MB are uploaded uncompressed and shown in 250 px rows with no `resizeMethod`; catalogue images are bare full-size URLs decoded into 60 px grid cells. Always compress to ≤ 1024 px; add `resizeMethod="resize"` on Android. No image-caching library is installed; plain `<Image>` with remote URIs is used in 84 places.
- **Loading / empty / error states are inconsistent.** Trades blanks the screen with a spinner; Designs has a skeleton; Home tab and Values have no first-load state and Home tab failures are silent (0 `showErrorMessage`). Reuse the Designs skeleton row for Trades and Values; copy the `CatalogStatus` pattern for Home errors.
- **Accessibility is essentially absent**: 2 `accessibilityLabel`, 4 `accessibilityRole`, 0 `allowFontScaling` across 215 files; tab icons are 18 px with 9 px labels; 26 `hitSlop` uses, none on the main five screens. Arabic ships without any RTL decision (`I18nManager` appears once).
- **Haptics are inconsistent**: 99 calls in 21 files, but Home tab, group chat, private chat and the feed have none, although a shared hook exists.
- **Settings is one 4,126-line component** with five full modal flows inline. Users see a reasonable two-tab list; the cost is change risk, not UX.

## 5. Data layer and offline

Already right: the Home tab's live-listener footprint is tiny (nine RTDB leaf listeners, no Firestore or Supabase until Chat is opened, no large-node listeners left); chat channels subscribe on focus and unsubscribe on blur, gap-fill on reconnect, and close the socket after 20 s in background; read receipts are coalesced; the catalogue fetch has a 12 s deadline, abort, cached fallback and a visible retry.

Findings, most impactful first:

- **The catalogue's 24 h cache is defeated on every cold start.** `fetchStockData` decides `shouldFetch` from `localStateRef.current.data` ([Code/GlobelStats.js:1062-1068](Code/GlobelStats.js:1062)), which is still `null` because MMKV hydration runs in a *later* idle callback ([Code/LocalGlobelStats.js:133-157](Code/LocalGlobelStats.js:133); child effects register before the parent's). So both catalogues (~105 KB gzipped, ~1.2 MB raw each) are downloaded, parsed and re-stringified to MMKV on **every launch**, on the JS thread, while the first screen paints. Gate the fetch on hydration (or call it from the hydration callback) and check `fetchDataTime` first. This is both a cold-start and a bandwidth/cost item.
- **DM and group sends are not optimistic**: the bubble appears only after the insert and the realtime echo ([Code/ChatScreen/PrivateChat/PrivateChat.jsx:902](Code/ChatScreen/PrivateChat/PrivateChat.jsx:902), [GroupChatScreen.jsx:879](Code/ChatScreen/GroupChat/GroupChatScreen.jsx:879)), and group send then awaits the meta fan-out sequentially. On a weak link that is 0.5–2 s between tap and bubble. The public room already has the `_pending` / `clientMsgId` placeholder pattern ([Trader.jsx:1128](Code/ChatScreen/GroupChat/Trader.jsx:1128)); reuse it.
- **The Designs feed polls Firestore every 30 s for the whole session** once visited ([Code/Design/DesignMainScreen.js:414-449](Code/Design/DesignMainScreen.js:414)); tabs are lazy but never unmount, so it keeps running under Chat and Trades. Gate on `useIsFocused()` and `AppState === 'active'`, or refresh reactions on focus only.
- **Trades first load is a sequential waterfall behind a full-screen spinner** (normal then featured `getDocs`, [Code/Trades/Trades.jsx:1200,1223](Code/Trades/Trades.jsx:1200)) with no cached-first paint, and it refetches on every `user.id` change. `Promise.all` the two queries and keep the last list in MMKV under a refresh bar.
- **Chat first pages are too small to fill a tall screen** (public room 5, DM/group 10, with `onEndReachedThreshold 0.1`), so pagination fires right after the first paint. Load 25–30 first, then 10–20 per page.
- **No offline detection anywhere** (no NetInfo), so a failed fetch renders as "No trades yet" / "No posts found". Of roughly 900 catch blocks, about 150 are silent and 380 log only. Add a connectivity banner and make list screens distinguish offline / error-with-retry from genuinely empty.
- **RTDB disk persistence is never enabled**, so every `get()` on an offline cold start has nothing to serve. One `setPersistenceEnabled(db, true)` before first use.
- **Chat image upload streams the whole file through the JS heap** (`RNFS.readFile` base64 → JS byte conversion → `fetch` PUT, [PrivateMessageInput.jsx:252-268](Code/ChatScreen/PrivateChat/PrivateMessageInput.jsx:252)), and only compresses above 1 MB. Compress always; upload natively. Side note: the Bunny storage access key ships inside the client bundle.
- **Profile cache is expire-then-block**, not stale-while-revalidate ([Code/Helper/profileCache.js:51-100](Code/Helper/profileCache.js:51)): past 30 min it drops the entry and awaits four Supabase queries. Return stale immediately, refresh in background.
- **A forced server-time probe (RTDB write + read) runs on every foreground** ([GlobelStats.js:1206](Code/GlobelStats.js:1206) passes `forceProbe=true`, bypassing the 30 s cache). Honour the cache unless the last probe is minutes old.

## 6. Recommended order

| # | Change | Effort | Payoff |
|---|---|---|---|
| 1 | ~~Triage the iOS 11.9 nil-key crash~~ Done: Google backend incident on 2026-09-29, no events since; optionally bump GoogleUtilities to 8.1.4 | S | Closed; nothing to ship |
| 2 | Smoke-test the release AAB on a device before every rollout | S | Catches R8/reflection launch crashes like 1.15.40 |
| 3 | Cap the update checker (FLEXIBLE on Android; once per 24 h and per store version on iOS) | S | Stops kicking iOS users to the App Store every launch |
| 4 | Sequence first-session prompts; push at a value moment; review after a success moment | M | Fewer, never-overlapping prompts before first value |
| 5 | Gate the catalogue fetch on MMKV hydration so the 24 h cache actually works | S | Removes ~2.4 MB of download + parse + stringify from every cold start |
| 6 | Start login reads immediately; render from a cached profile | M | Removes the signed-out flash and most of the 3 s hold |
| 7 | Defer ads init when no cold-start ad is eligible; kick it early when it is | S | Faster first paint on most launches, more ads actually landing on eligible ones |
| 8 | Guard the presence spread; split the global context | M | Kills app-wide re-renders on presence/online flips |
| 9 | Chat: local `input` state, `useCallback(onReply)`, drop `forceDetail`, `windowSize` 9, memo profile cache, optimistic sends, bigger first page | M | Smooth typing, scrolling and instant-feeling sends in the busiest screens |
| 10 | Trades/feed: memoised row components, keys by id, memoised interleave, parallel first load, focus-gated 30 s poll | M | Smooth scrolling and faster first paint on the two other hot lists |
| 11 | Startup trims: lazy `ru`, per-level Lottie, pause on blur, drop dead MMKV keys, dedupe Home fetches, inline-require tabs | S | A few hundred ms on low-end Android |

Smaller, worth doing when touching the area: cross-format ad cooldown (defer, never skip), skeletons on Trades/Values, Home error surfacing, offline banner + RTDB persistence, accessibility roles/labels and `hitSlop` on the five main screens, compress all chat uploads and upload natively, `resizeMethod` on Android images, stale-while-revalidate profile cache, decide RTL for Arabic.

## 7. What is already done well

- Headless pushes never cold-start the React tree; the top ANR source from before 2026-09-29 is gone.
- Cold-start App Open ad is shown from the splash only, never over a live Home, with first-launch, Pro and 4 h exclusions; interstitials never gate content (cooldown-skip and watchdog always run the caller's callback).
- Consent runs before the ads SDK initialises, so EEA impressions carry a TC string.
- Floating buttons derive their offset from one helper so they never cover the banner or the chat input; banner slots reserve zero height until loaded.
- Empty states on Trades, Feed, group chat and the pet picker tell the user what to do next.
- Startup timings (`startup_profile_reads`, `startup_ready`) already go to Analytics, which is the right place to measure any of the changes above (watch p50/p90 before and after).

## Status (2026-10-03, same day)

Applied in the working tree as the first batch (uncommitted; lint error counts per file and the jest failure set are unchanged from before, and a release bundle builds):

- Catalogue fetch now waits for MMKV hydration (`catalogHydrated` in [Code/LocalGlobelStats.js](Code/LocalGlobelStats.js), gate in [Code/GlobelStats.js](Code/GlobelStats.js)), so the 24 h cache applies. Stale `normalStock` / `mirageStock` / `prenormalStock` / `premirageStock` / `postsCache` keys are no longer parsed and are removed once.
- Update checker ([Code/AppHelper/InAppUpdateChecker.js](Code/AppHelper/InAppUpdateChecker.js)): one nudge per 24 h per store version; Android uses FLEXIBLE and installs the downloaded update only when the app is in the background.
- Presence no longer replaces the `user` object when `online` is unchanged.
- [i18n.js](i18n.js) evaluates English plus the user's own language only (Russian was eager for everyone); the initial language is in `resources` from the first frame, so no English flash.
- Home tab loads only the current level's Lottie and pauses it while another tab is in front; the owned-pets Firestore read on mount is gone (the focus effect already does it); cosmetics sync shares one in-flight read per uid between Home and MainTabs.
- Community chat: the composer owns its draft, so typing no longer re-renders the room or its message rows; `onReply`, `handlePinMessage` and `handleRefresh` keep stable identities.

Not yet done from the list above: iOS 11.9 crash triage, first-session prompt sequencing, login reads before idle, ads-init deferral, context split, Trades/feed row memoisation, `forceDetail` in chat rows, optimistic chat sends, offline handling.

## How to measure

Use the existing `startup_ready` Analytics event (p50 / p90 by platform and device tier) as the single cold-start metric, Crashlytics crash-free *sessions* per version as the stability metric, and AdMob match rate on the App Open unit to confirm change 6 does not lose impressions. For scroll work, the React DevTools profiler on the community chat while typing is the quickest before/after.
