# Badge rail + Squad join fixes, 2026-10-02

Follows the squad / badge audit of 2026-10-02. **Uncommitted** (the owner commits).

## Why

A name row could carry up to eight things: Pro icon, Verified icon, an Admin/Mod/JMD
pill, Trusted, CMSR and Helper pills (each icon + translated text), and on trade
cards a rating pill (shown even as "N/A") plus a squad pill. Rows wrapped, pills
spilled onto two or three lines under a message, and the same six-pill block was
copy-pasted into seven files.

## What changed

### One badge rail (`Code/Helper/UserBadgeRail.jsx`, logic in `Code/Helper/badgeRail.js`)

- **Inline** (chat rows, group chat, online list, private chat header, feed post
  cards, trade cards): Pro icon, then at most **3 glyphs**, never wrapping, then a
  "+N" chip. Only the one authority pill (Admin / Mod / JMD) keeps its text label;
  Trusted, CMSR, Helper, squad rank (3+ friends) and Verified are 14 px icons.
  The name has `flexShrink: 1` so it ellipsizes instead of pushing badges off-row.
- **Full** (profile drawer): every badge as a labelled pill, wrapping; squad from the
  first counted friend ("Squad N"); Pro stays on the banner.
- **Priority** (first wins when space runs out) is one constant, `ORDER` in
  `badgeRail.js`: `admin > mod > jmd > trusted > cmsr_house > cmsr_art > helper > squad > verified`
  (2026-10-03: CMSR split into House and Art, see CMSR_SPLIT_HANDOFF_2026-10-03.md).
  Reorder there and every surface follows.
- Group chats pass `allowed` without `admin`/`mod`, as the old block did.
- Squad rank now shows in chat too, at zero extra reads: `resolveProfile` and the
  private-chat header carry `squadCount` from the cached cosmetics row.

### Trade card

Rating moved off the name row to the second line (time · ELV/GG · ★ 4.8 (12)).
The "N/A" rating pill is gone: an unrated poster shows nothing.

### Squad join (from the audit's gap list)

- Squad screen: the "Have a friend's code?" / "You're in X's squad" card is now the
  first card under the hero while the account can still join. A muted footnote
  (`squad.join_window_closed`) replaces it for accounts past the 7-day window.
- Home Squad card subtitle says "Have a friend's code? Enter it here" for a new
  account that has not joined (`canStillJoin` in `squad.js`).
- `SquadBootstrap` shows a one-time, non-blocking flash message after sign-in for
  the same accounts, unless an Android install link already carries a code
  (`takeCodeNudge`). Never a modal, so it cannot collide with the sign-in drawer or
  the cold-start ad.

### Removed

Dead imports of `BADGE_IMAGES` / `BADGE_DEFINITIONS` in MessagesList, PostCard and
Trades (achievement badges were never drawn inline; they remain on the profile
showcase and the Badges screen). `UserBadgePill` is still the pill primitive; only
`UserBadgeRail` imports it now.

## Strings

Four new keys under `squad` in all six languages: `join_window_closed`,
`home_have_code`, `ask_code_title`, `ask_code_body`. i18n check: 0 missing, 0
English fallbacks.

## Checks

- jest: 206 pass, the same two pre-existing failures (`safeChat`, ESM `App.test.tsx`).
  `__tests__/badgeRail.test.js` covers the order, the cap, `canStillJoin`, `takeCodeNudge`.
- eslint: no new errors in any touched file (per-file diff against HEAD). New
  warnings are `react-native/no-inline-styles` on the row tweaks, in files that
  already carry dozens.
- `react-native bundle --dev false` builds; `hermesc` compiles the bundle.
- Loaded on the Android emulator (debug build 1.15.41 + Metro): see "Verified on
  device" below.

## Verified on device (Android emulator, Metro, 2026-10-02 23:00)

| Surface | Seen |
|---|---|
| Group chat row | `GhostPrinceNico` + Pro + **MOD** pill + Trusted icon + Verified icon (+ admin-only OS icon), one line |
| Trade card | `Otto Smyle De Leon` + Verified icon; second line `an hour ago · ELV`; unrated poster shows no rating pill |
| Online users sheet | `Noa` + Verified icon, name shrinks, no wrap |
| Private chat header | `Noa` + Verified icon + copy, "Online" on the line below |
| Profile drawer (full) | labelled **Verified** pill under the name |
| Squad screen | footnote "Squad codes can only be used in the first 7 days…" for an account past the window; join card absent (correct for this account) |

Not seen on a device, covered otherwise:
- feed post card (same code path as the trade card);
- the "+N" chip and the squad glyph (need a player with 4+ badges / 3+ friends;
  `badgeRail.test.js` covers the cap and the rank threshold);
- the Home card subtitle and the one-time nudge (need an account under 7 days;
  `canStillJoin` / `takeCodeNudge` are unit-tested).

Still to do by the owner: a quick look on iOS, then commit.
