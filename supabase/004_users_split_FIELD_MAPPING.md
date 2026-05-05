# RTDB /users/{uid} → Supabase user_* tables — field mapping

Source of truth for `functions/mirrorUsersToSupabase.js`. If a field appears
here it gets mirrored. If it doesn't, it stays on RTDB only (deferred to a
future phase). The mirror CF must NEVER read or write fields outside this list.

**Pattern**: RTDB is source of truth. CF triggers on `/users/{uid}` writes.
On every change, CF re-reads the affected `/users/{uid}` subtree and upserts
the relevant row(s) in the Supabase split tables. Deletes propagate as
table deletes.

**Naming convention**: RTDB uses camelCase, Supabase uses snake_case. Mirror
translates both directions. Three deliberate semantic renames called out below.

---

## Table 1 — `user_identity`

One row per uid. Triggered by writes to any of these RTDB paths under `/users/{uid}/`.

| RTDB key                | Supabase column           | Type        | Notes |
|-------------------------|---------------------------|-------------|-------|
| `displayName`           | `display_name`            | text        | |
| `avatar`                | `avatar`                  | text        | URL |
| `email`                 | `email`                   | text        | |
| `decodedEmail`          | `decoded_email`           | text        | RTDB-encoded email decoded back |
| `flage`                 | `flag`                    | text        | **Renamed** — typo fix |
| `dateOfBirth`           | `date_of_birth`           | text        | RTDB stores as string |
| `OS`                    | `os`                      | text        | 'ios' or 'android' |
| `createdAt`             | `created_at_ms`           | bigint      | ms epoch |
| `lastActivity`          | `last_activity_ms`        | bigint      | ms epoch |
| `lastProfileEditAt`     | `last_profile_edit_ms`    | bigint      | ms epoch |
| —                       | `updated_at`              | timestamptz | set by mirror to `now()` |

**Dropped (was in PROJECTION but no readers found):**
- `userName`

---

## Table 2 — `user_roblox`

| RTDB key                 | Supabase column            | Type    | Notes |
|--------------------------|----------------------------|---------|-------|
| `robloxUsername`         | `roblox_username`          | text    | |
| `robloxUserId`           | `roblox_user_id`           | text    | RTDB stores as string |
| `robloxUsernameVerified` | `roblox_username_verified` | boolean | |

Partial unique index on `lower(roblox_username) WHERE verified = true` is
applied. Mirror should NOT translate uniqueness errors — let them fail loud
if two users somehow both verify the same name (means RTDB is inconsistent).

---

## Table 3 — `user_roles`

| RTDB key       | Supabase column  | Type    | Notes |
|----------------|------------------|---------|-------|
| `admin`        | `is_admin`       | boolean | **Renamed** — canonicalize. NOT `users/{uid}/isAdmin` (that path is dead). |
| `isModerator`  | `is_moderator`   | boolean | |
| `isBabyMod`    | `is_baby_mod`    | boolean | |
| `isTrusted`    | `is_trusted`     | boolean | |
| `isCMSR`       | `is_cmsr`        | boolean | |

All default to `false` if RTDB key is missing. RTDB-trigger CFs
(`syncModRole_Moderator`, `syncBadgeRoster`) keep firing on the original
RTDB paths — they're untouched.

---

## Table 4 — `user_cosmetics`

| RTDB key      | Supabase column | Type    | Notes |
|---------------|-----------------|---------|-------|
| `topBadge`    | `top_badge`     | text    | badge id |
| `isPro`       | `is_pro`        | boolean | |

**Profile frame is NOT mirrored.** Frame data lives at
`/users/{uid}/shop/activeItems/profileFrame` (the shop subtree, deferred
to a future phase). The top-level `/users/{uid}/profileFrame` field is
dead — never written by any flow. The 3 client reads against it
(SocialDashboard:140, PrivateChatHeader:75, BlockUserList:65) always
returned null and should be cleaned up during the wave-2 client rollout.
Real frame rendering reads `shop/activeItems/profileFrame` directly from
RTDB and continues to work unchanged.

---

## Table 5 — `user_notifications`

| RTDB key                | Supabase column           | Type    | Notes |
|-------------------------|---------------------------|---------|-------|
| `isTokenInvalid`        | `is_token_invalid`        | boolean | |
| `muteTradeNotifs`       | `mute_trade_notifs`       | boolean | |
| `notificationSettings`  | `notification_settings`   | jsonb   | Whole blob. Keys vary (`groupChatNotifications`, `notifyMessages`, etc) — JSONB so we don't care. |

**Deliberately NOT mirrored this phase:**
- `fcmToken` — every notification CF reads it directly from RTDB. Migrating
  it would silence pushes. Phase 3 deals with this.

---

## Table 6 — `user_settings`

| RTDB key                       | Supabase column                  | Type    | Notes |
|--------------------------------|----------------------------------|---------|-------|
| `isReminderEnabled`            | `is_reminder_enabled`            | boolean | |
| `isSelectedReminderEnabled`    | `is_selected_reminder_enabled`   | boolean | |

---

## Table 7 — `user_badges` (relational)

RTDB shape: `/users/{uid}/badges/{badgeId}` → `true` (always literal `true`,
verified across badgeUtils.js). No object-shaped badge values found in
source.

| RTDB                                  | Supabase row                                    |
|---------------------------------------|-------------------------------------------------|
| `badges/{badgeId} = true`             | `(uid, badge_id) = (uid, badgeId)`              |
| (RTDB has no earned-at timestamp)     | `earned_at_ms = mirror's now() at first write`  |
| (RTDB has no metadata)                | `metadata = null`                               |

Mirror behavior: on `/users/{uid}/badges` change, do a full diff:
- For each badge in RTDB but not in Supabase → insert with `earned_at_ms = now()`
- For each badge in Supabase but not in RTDB → delete
- Existing badges: leave alone (don't update earned_at_ms on every parent write)

This keeps "earned_at_ms" stable across CF re-runs.

---

## Table 8 — `user_blocks` (relational)

RTDB shape: `/users/{uid}/blocked_users/{blockedUid}` → `true` (always
literal `true`, verified across BottomDrawer.jsx, BlockUserList.jsx,
PrivateChatHeader.jsx).

| RTDB                                              | Supabase row                                    |
|---------------------------------------------------|-------------------------------------------------|
| `blocked_users/{blockedUid} = true`               | `(uid, blocked_uid) = (uid, blockedUid)`        |
| (RTDB has no blocked-at timestamp)                | `blocked_at_ms = mirror's now() at first write` |

Same diff strategy as `user_badges`. Don't update `blocked_at_ms` on existing rows.

---

## RTDB fields DELIBERATELY NOT mirrored (this phase)

These stay on RTDB. Future phases may migrate them.

**Economy / gameplay** (Phase 5 candidate):
- `rewardPoints`, `xp`, `xp.total`, `xp.level`
- `dailyStars`, `dailyStars.starBalance`
- `levelRewards/*`
- `lastGameWinAt`, `hasRecentGameWin`, `isPlaying`
- `freeTradeUsed`
- `streak`, `counters`

**Shop** (Phase 5 candidate):
- `shop/activeItems/*` (entire subtree)
- `shop/inventory/*` (append-only purchase log)
- `shop/ownedItems/*` (cosmetic inventory)
- `shop/stats/*` (aggregate counters)

**Notifications-adjacent** (Phase 3 — moves with messages):
- `fcmToken` — notification CFs depend on this being on RTDB

**Dropped entirely (no readers found):**
- `userName` — was in PROJECTION but no actual reader

---

## CF trigger path

```
functions.database
  .ref('/users/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const after = change.after.val();   // null on delete
    const before = change.before.val(); // null on create

    if (after === null) {
      // delete — remove rows from all 8 tables for this uid
      return supabaseAdmin.deleteAllUserRows(uid);
    }

    // upsert each table. The mirror reads `after` and writes the
    // 8 split tables. Each upsert is independent — partial failure
    // is acceptable (next /users write will retry).
    await Promise.all([
      mirrorIdentity(uid, after),
      mirrorRoblox(uid, after),
      mirrorRoles(uid, after),
      mirrorCosmetics(uid, after),
      mirrorNotifications(uid, after),
      mirrorSettings(uid, after),
      mirrorBadges(uid, after),
      mirrorBlocks(uid, after),
    ]);
  });
```

**Cost note**: this CF will fire on EVERY write to `/users/{uid}`,
including hot-path writes to economy fields (`rewardPoints` increment)
that we're NOT mirroring. The CF still fires; it just no-ops most of
those writes (no relevant fields changed). This is acceptable —
RTDB-onWrite invocations are cheap and the alternative (per-field
triggers) creates 8× the CF deployments.

If invocation count gets painful, we can add a per-field path filter
later — but only after measuring.
