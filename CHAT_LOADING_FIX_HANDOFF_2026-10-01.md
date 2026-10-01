# Chat loading fix — handoff (Adopt Me, 2026-10-01)

**Status:** fixed in code, **uncommitted**, not yet in a release.
**Plan:** commit → ship in the next Adopt Me build → verify in production (checklist in §6) → then port to the other apps (§7).

---

## 1. What the owner reported

- Opening a DM from the inbox sometimes takes a long time to load.
- After the app has been open a while, leaving a DM and coming back leaves the spinner up longer.
- Needed a check that DMs, the main public chat and all group chats load properly, with no repeated or wasted requests.

---

## 2. Bugs found and how each was fixed

### Bug 1 — Live messages silently stop after leaving and re-entering a chat (HIGH, correctness)

**Symptom:** you leave a DM, group or the public room and come back quickly (a quick back-and-forth, opening the image viewer, a tab switch). The chat loads, but **new messages never arrive live** until you close and reopen it.

**Cause:** every chat subscribed to Supabase Realtime with a **fixed channel name** (`pvt-messages:<chatId>`, `group-messages:<groupId>`, `room-messages:<roomId>`, `pinned:<roomId>`). In supabase-js 2.117:

- `supabase.channel(name)` **returns the existing channel** if one with that name is still registered.
- `removeChannel()` keeps the old channel registered (state `leaving`) until the server confirms the leave, which takes one network round trip and can be seconds on bad networks.
- Re-subscribing inside that window got the dying channel back:
  - `.on()` attached to it;
  - `.subscribe()` did nothing, because it only joins a channel in the `closed` state;
  - then the leave completed and the channel was thrown away.

  The result was no live messages and no status callback, so no recovery either.

**Fix:** every subscribe call now uses a unique channel name.

- New helper `uniqueTopic(base)` in `Code/Supabase/chatBackend.js`.
- Used in `subscribeToMessages`, `subscribeToPinned`, `subscribeToPrivateMessages` and `subscribeToGroupMessages`.
- Chat-meta and group-meta already did this.

### Bug 2 — Messages sent while a chat was hidden or the app was backgrounded never appear (HIGH, correctness)

**Cause:**
- Realtime does not replay events missed while disconnected.
- `client.js` drops the realtime socket after 20 s in the background, and Android 15 kills a background app's sockets after about 2–4 s anyway.
- The DM screen and the group chat screen had **no gap-fill**. The groups list had none either, while the DM inbox did.

**Fix:**
- **DM + group chat:** on every `SUBSCRIBED` (first join, re-focus, reconnect), once the first page has loaded, fetch only rows newer than the newest one on screen (`loadPrivateMessagesSince` / `loadGroupMessagesSince`, limit 50) and merge them in.
- **Groups list:** `subscribeToGroupMeta` (`groupMetaBackend.js`) now gap-fills on reconnect, using the same pattern as `subscribeToChatMeta`.

### Bug 3 — Every DM/group open shows a full-screen spinner, even for a chat just viewed (MEDIUM, UX)

**Cause:** the screens unmount on back, and `loadMessages(true)` cleared the list and showed the spinner on every visit.

**Fix:**
- **Session cache:**
  - In memory, per chat, for the current app session: up to 20 chats and 50 messages each. Nothing is written to disk.
  - DMs are keyed by `chatKey`, which contains both UIDs. Groups are keyed by `uid:groupId` and read only after membership is confirmed.
- **Reopening a chat:**
  - The cached messages paint instantly while the fresh page loads.
  - The fresh page wins. Rows outside its time range are kept (older history, realtime inserts that landed mid-request); rows inside the range but missing from it are treated as deleted.
- **Exact cursors:** rows now carry the raw `createdAt` (microsecond `created_at`). Before, a ms-truncated cursor could skip or repeat messages that shared a millisecond.
- **Pagination guard:** it now uses a ref instead of state, because `onEndReached` could fire twice before the re-render.

### Bug 4 — Opening a DM fired ~12 Supabase requests; the message load queued behind them (MEDIUM, speed + cost)

**Cause:** `PrivateChat.jsx` always mounted `ProfileBottomDrawer` hidden, and the drawer fetches the partner's full profile on mount even when invisible:
- Supabase: identity, roles, cosmetics, roblox, badges;
- several RTDB reads (XP, cosmetics, role leaves);
- a Firestore follow query.

The header fetched roles, cosmetics and roblox again (3 duplicates). On Android, React Native's OkHttp runs only **5 requests per host at once**, so the messages query waited its turn.

**Fix:**
- The drawer is mounted only after it is first opened (`drawerMounted` in `PrivateChat.jsx`).
- `PrivateChatHeader.jsx` caches its lookup per uid for 10 minutes.
- Removed a duplicate `clearActiveChat` RTDB write on every DM exit.

### Bug 5 — Reopening the inbox shows the skeleton, then "No chats", for up to 1.5 s (MEDIUM, UX)

**Cause:**
- The shared chat-meta subscription already holds the rows and replays them instantly.
- But `InboxScreen` pushed every update through a 500 ms debounce plus `requestIdleCallback` (up to 1 s), including the very first paint.
- Meanwhile `onReady` dropped the loading flag before the list was filled.

**Fix:**
- The first paint flushes on the next tick.
- `onReady` flushes the list instead of only clearing the loader.
- The debounce now applies only to later realtime bursts.
- **Measured: 2 ms.**

### Bug 6 — Public room blanks to a spinner when you come back after a busy few minutes (MEDIUM, UX)

**Cause:**
- Gap-fill fetches up to 60 rows. If the gap was bigger, it called `loadMessages(true)`, which set `loading=true`, and the whole list was swapped for a spinner.
- Pull-to-refresh did the same.

**Fix:**
- `loadMessages(reset, { silent })` in `Trader.jsx`.
- Gap-fill resets and pull-to-refresh are silent: the old list stays until the new page replaces it.

### Bug 7 — The realtime "reset" helper never reconnected (MEDIUM, correctness)

**Cause:** `resetRealtimeAndAuth()` (`chatBackend.js`) called `realtime.disconnect()` without awaiting it, then `connect()`. But `connect()` does nothing while the socket is still closing, and Phoenix does not auto-reconnect after a clean close. Every channel stayed down until something else re-subscribed. It runs from the public room's `CHANNEL_ERROR` retry and from pull-to-refresh.

**Fix:** `await supabase.realtime.disconnect()` before `connect()`.

### Bug 8 — Group chat: two loaders in a row (MEDIUM, speed)

**Cause:** the Firestore membership check (`onSnapshot(groups/{id})`) had to finish before the message query even started.

**Fix:**
- The first message page is fetched at mount, **in parallel** with the membership check.
- It is used only if it is less than 10 s old and the user turns out to be a member.
- Non-members never see it, and group_messages row-level security returns nothing to non-members anyway.

**Measured:** messages ready 125–230 ms after membership resolves, instead of a full extra round trip.

### Bug 9 — "All Groups" tab reloads with a spinner on every message in any joined group (MEDIUM, speed + cost)

**Cause:** the `getAllGroups` effect in `GroupsScreen.jsx` had `filteredGroups` in its dependencies without using it. Any group meta change re-ran the Firestore query and the creator-name batch, flashed the spinner and reset pagination.

**Fix:** removed that dependency. "Already joined" is still computed at render time.

---

## 3. Investigated and NOT a bug — the "~60 s hang after returning to the app"

On the emulator, requests sent right after returning from the background looked stuck for 60–110 s. Instrumented and resolved:

- The **app-open ad** (`Code/Ads/openApp.js`: on foreground, at most every 2 min, non-Pro users only) covers the app about 1.4 s after it returns.
- RN then gets `onHostPause`, so AppState becomes `background` and `JavaTimerManager` **pauses all JS timers**.
- RN's `fetch` (the whatwg-fetch polyfill) hands back every response via `setTimeout(…, 0)`. So responses that had already arrived natively wait until the ad closes.
- On the emulator nobody closed the ad. Each "hang" ended exactly when Back dismissed it, and a mid-hang thread dump showed no network call in progress.

**For real users there is no extra delay:** they're looking at the ad, and everything resumes the moment it closes.

**Real network numbers after returning:**
- The first requests take about 1.4 s. Android 15's network policy blocks the backgrounded app (`blocked=APP_BACKGROUND`) and its sockets are torn down, so it needs a new TLS connection.
- After that, 400–850 ms per request.

**Diagnosis kit (no root needed):**
- a temporary supabase `global.fetch` timing wrapper plus a `setInterval` heartbeat, logged to logcat;
- `/proc/net/tcp` filtered by the app uid;
- `adb shell dumpsys netpolicy | grep UID=<uid>`;
- thread stacks via `adb forward tcp:8700 jdwp:<pid>` then `jdb -attach localhost:8700`, running `suspend` / `where all` / `resume`.

The emulator's log clock runs about 5 s behind the Mac.

---

## 4. Measured on the emulator (Pixel 9 AVD, Android 15, debug build)

| Path | Before | After |
|---|---|---|
| Inbox reopen | skeleton, then "No chats", up to 1.5 s | painted in 2 ms |
| Group reopen | full spinner every time | cached messages within 0.5 s; fresh page merged at ~380 ms |
| Group first open | membership check, then message fetch, one after the other | fetch in parallel; messages 125–230 ms after the check |
| DM open | ~12 concurrent requests | messages query plus 3–4 small calls; profile loads only when opened |
| Supabase round trip from PK | — | 400–900 ms (network floor) |

**Not verified on device:**
- **Real DM content:** the test account (How2_Tech) has no DMs newer than 20 days, so all threads were empty.
- **Sending:** no message was sent.
- **Profile drawer:** opening it from the DM header was not tested on device.

Everything passes ESLint parsing, and the full bundle compiles with Hermes (`hermesc`).

---

## 5. Cost impact

Expected **neutral to slightly lower**.

**Lower:**
- **Hidden drawer:** each DM open no longer makes 5 Supabase reads plus RTDB and Firestore reads for a profile nobody opened.
- **Header cache:** reopening a DM no longer repeats 3 Supabase reads.
- **All Groups tab:** no longer re-queries Firestore on every message.
- **DM exit:** one duplicate RTDB write removed.

**Slightly higher:**
- **Gap-fill:** one tiny query per (re)subscribe, usually 0 rows.
- **Live delivery:** chats whose live channel used to die now actually receive realtime messages, as they always should have.

**Unchanged:** one fresh first-page fetch per chat open (the cache doesn't skip it) and one realtime channel per open chat.

To confirm, compare the Firebase usage and Supabase usage reports (realtime messages, egress) for a week before and after the release.

---

## 6. Production verification — do this before porting

Test with **two accounts on two devices** (one Android 15+). Then watch Crashlytics and store reviews for a few days.

1. **DM:** A sends to B, and the message appears live for B.
2. **Quick reopen:** B goes back and immediately reopens the DM. The messages show instantly (no spinner), and A's next message still arrives live. *(This is Bug 1; it used to fail.)*
3. **Background gap:** B backgrounds the app for 30+ s, A sends 2 messages, B returns. Both messages appear without reopening the chat. *(Bug 2.)*
4. **Groups:** repeat steps 1–3 in a group chat, and once in the public room.
5. **Inbox:** open the inbox, go back and reopen it. There's no "No chats" flash.
6. **Profile drawer:** in a DM, tap the header name. The profile drawer opens and loads.
7. **Groups screen:** "All Groups" doesn't reload while messages arrive in joined groups.
8. **Crashlytics:** no new crash clusters in PrivateChat, GroupChatScreen, Trader, InboxScreen or GroupsScreen.

Only after these pass in production: port it (§7).

---

## 7. Porting plan for the other apps

### Blox Fruit (`Blox_Fruit/`) — same Supabase chat stack; most fixes apply

| Fix | Blox Fruit status | Action |
|---|---|---|
| Bug 1 unique topics | **Already done** (random suffixes in every backend) | none |
| Bug 2 DM gap-fill | **Missing** (`PrivateChat.jsx` has no `…Since` call) | port |
| Bug 2 group chat gap-fill | Has one (`sbLoadGroupMessagesSince` around line 552) | verify only |
| Bug 2 group-meta gap-fill | **Missing** in `groupMetaBackend.js` | port |
| Bug 3 session cache, DM + group | Missing | port |
| Bug 4 hidden drawer fetches | **Present**: `BottomDrawer.jsx` effects at ~254 and ~914 fetch without `isVisible`; `PrivateChat.jsx` mounts it hidden | port (lazy mount) |
| Bug 4 header fetch cache | Present (`PrivateChatHeader.jsx` `getRoles…` on every open) | port |
| Bug 5 inbox first-paint debounce | **Present** (`InboxScreen.jsx` 500 ms + `requestIdleCallback`) | port |
| Bug 6 silent public-room reset | Check the public room's gap-fill path | check |
| Bug 7 un-awaited disconnect | **Present** (`chatBackend.js` ~line 61) | port (1 line) |
| Bug 8 group prefetch | Check `GroupChatScreen.jsx` | check |
| Bug 9 All Groups dependency | Not present | none |

**Blox Fruit is a production app with old builds in the field.** Every change here is client-only and backward compatible: no schema, rules or Cloud Function changes.

### mm2values, FischValues, StealAnEggValues — Firebase RTDB chat; most fixes don't apply

- No Supabase Realtime, so Bugs 1, 2, 6 and 7 don't apply. RTDB listeners re-sync themselves after a reconnect.
- Their `BottomDrawer.jsx` already has `isVisible` guards, so Bug 4 doesn't apply.
- **Optional:** the Bug 3 session cache for an instant DM/group reopen (pure UX). Check each inbox for the Bug 5 first-paint debounce before porting.

### How to port

Diff the Adopt Me versions of the files in §8 against the target app, and apply the same patterns rather than copying files: the apps diverged after forking. Always run `hermesc` over a full bundle afterwards: Hermes rejects some syntax that ESLint and Metro accept.

---

## 8. Files changed in Adopt Me

`Code/` contains other uncommitted work too. These are the chat-fix files:

- `Code/Supabase/chatBackend.js`: `uniqueTopic()`, unique room/pinned topics, awaited disconnect in `resetRealtimeAndAuth`
- `Code/Supabase/privateMessagesBackend.js`: unique topic, `createdAt` on rows
- `Code/Supabase/groupMessagesBackend.js`: unique topic, `createdAt` on rows
- `Code/Supabase/groupMetaBackend.js`: reconnect gap-fill
- `Code/ChatScreen/PrivateChat/PrivateChat.jsx`: session cache, gap-fill, exact cursors, ref pagination guard, lazy drawer, duplicate write removed
- `Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx`: 10-minute lookup cache
- `Code/ChatScreen/GroupChat/GroupChatScreen.jsx`: session cache, gap-fill, parallel first-page prefetch, ref pagination guard
- `Code/ChatScreen/GroupChat/InboxScreen.jsx`: immediate first paint
- `Code/ChatScreen/GroupChat/Trader.jsx`: silent reset for gap-fill and pull-to-refresh
- `Code/ChatScreen/GroupChat/GroupsScreen.jsx`: removed the spurious All Groups reload dependency

`Code/Supabase/client.js` also has an uncommitted **role-claim token refresh** from a different session (Squad / Trade Match work). It is not part of this fix; commit it with its own change.

---

## 9. Left over (not fixed, lower priority)

- **GroupsScreen remounts on every entry:** it re-creates 3 Firestore `onSnapshot` listeners (2 duplicate `CommunityChatHeader`'s) plus a `getCountFromServer`, and the skeleton also waits on the invitations snapshot.
- **Public room profile warm-up** (`MessagesList.jsx` ~115): re-runs on every message change with no in-flight de-duplication. Senders with no profile rows are never cached, so they're refetched on every insert.
- **Groups skeleton could stay up forever (suspected):** `subscribeToGroupMeta` `onReady` needs a `SUBSCRIBED`, so if the first join keeps failing, the skeleton stays even though the rows loaded.
- **History gap after a long session:** the 150-message live cap trims rows that pagination already loaded while the cursor still points past them, so scrolling up after a long busy session can skip a stretch.
- **Extra RTDB writes on group open:** the `GroupChatScreen` active-chat focus effect re-runs when `groupData` arrives, causing duplicate `setActiveChat` / `setActiveGroupChat` writes.
