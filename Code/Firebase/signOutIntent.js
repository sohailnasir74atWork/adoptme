// Tells the app's own sign-outs apart from ones nobody asked for (2026-09-29).
//
// GlobelStats' onAuthStateChanged records every signed-in → null transition as
// the Crashlytics non-fatal `auth_signed_out reason=native-null`, to catch
// Firebase dropping a session by itself. It could not tell those from the
// app's own signOut()/delete() calls, so Settings logout, account deletion and
// the unverified-email sign-outs all counted as silent drops: 75 of the 120
// Android events in the week to 2026-09-29 came straight after the app's own
// unverified-email sign-out.
//
// Call markSignOutIntent(reason) right before any app-initiated signOut() or
// account delete(). When the null arrives the listener takes the mark, logs
// the reason as a breadcrumb only, and skips the silent Google re-login, which
// would otherwise sign the user straight back in (or recreate an account that
// was just deleted). A mark that no null follows (the call failed, or nobody
// was signed in) expires, so it can never hide a real drop later.
const INTENT_TTL_MS = 30000;

let _pending = null;

export function markSignOutIntent(reason) {
  _pending = { reason, at: Date.now() };
}

// The pending reason, cleared on read; null if none was set in the last
// INTENT_TTL_MS.
export function takeSignOutIntent() {
  const pending = _pending;
  _pending = null;
  return pending && Date.now() - pending.at < INTENT_TTL_MS ? pending.reason : null;
}
