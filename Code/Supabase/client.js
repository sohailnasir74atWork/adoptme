// Supabase client singleton, authenticated via Firebase ID token.
//
// - Auth: Firebase is configured as a Third-Party Auth provider in Supabase.
//   Every request grabs a fresh Firebase ID token and sends it in the
//   Authorization header; Supabase verifies it against Firebase's public
//   keys. RLS policies see the Firebase UID via the JWT `sub` claim.
// - We disable Supabase's own auth persistence because we don't use it —
//   Firebase is the source of truth.
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { getAuth, getIdToken, onAuthStateChanged } from '@react-native-firebase/auth';
import config from '../Helper/Environment';

// Resolves the first time Firebase has determined auth state. On
// cold-start, RN Firebase fires onAuthStateChanged TWICE: once
// synchronously with null (before restoration), then again with the
// real user a few seconds later after keychain restore. We must wait
// for the non-null fire — otherwise accessToken returns null,
// supabase-js falls back to the publishable key (not a JWT under the
// sb_publishable_ format), and Realtime rejects the channel with
// `InvalidJWTToken: Fields role and exp are required`.
//
// 3s timeout covers the genuinely-anonymous case (user has never
// signed in) — after the timeout we proceed without a JWT, and
// Realtime can use the apikey path. This wait happens at most once
// per app launch, on the very first request.
let _authResolved = false;
let _authResolveFn;
const _authReady = new Promise((resolve) => { _authResolveFn = resolve; });
{
  const unsub = onAuthStateChanged(getAuth(), (u) => {
    if (u && !_authResolved) {
      _authResolved = true;
      unsub();
      _authResolveFn();
    }
  });
  setTimeout(() => {
    if (_authResolved) return;
    _authResolved = true;
    _authResolveFn();
  }, 8000);
}

export const supabase = createClient(
  config.supabaseUrl,
  config.supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    // Called before every REST request AND every realtime channel join.
    // RN Firebase caches and auto-refreshes the token internally, so this
    // stays cheap on the hot path. We wait once on _authReady to absorb
    // the cold-start window where currentUser is null but auth is still
    // restoring — otherwise realtime opens with no JWT, falls back to
    // the publishable key (which isn't a JWT under sb_publishable_), and
    // hits InvalidJWTToken.
    accessToken: async () => {
      if (!_authResolved) await _authReady;
      const user = getAuth().currentUser;
      if (!user) return null;
      try {
        return await getIdToken(user);
      } catch (e) {
        console.warn('[supabase] getIdToken failed:', e?.message);
        return null;
      }
    },
  },
);

// -------------------------------------------------------------------
// Background disconnect / foreground reconnect
// -------------------------------------------------------------------
// Realtime postgres_changes are billed per delivered message. A user who
// leaves the app open on a busy public-room chat and then backgrounds it
// keeps the channel open — on Android the OS frequently keeps the
// WebSocket alive, so they keep RECEIVING (and being BILLED for) every
// room message while not even looking. The public room is ~75% of the
// realtime bill and its cost is the per-subscriber fanout, so dropping
// backgrounded subscribers is the single highest-leverage saving.
//
// We proactively close the socket once the app has been backgrounded for
// a short grace period, and reconnect on foreground. This is exactly the
// state iOS already reaches on its own (it kills the background socket
// within ~30s) — we just make it deterministic and extend it to Android.
// supabase-js keeps channels registered across a disconnect()/connect()
// cycle and rejoins them on reconnect; each room/meta subscription's
// onStatus → gap-fill path then backfills anything missed during the
// blur window. Auth is handled by the top-level `accessToken` callback —
// Realtime calls it on reconnect, so we don't touch realtime auth here.
//
// The grace timer avoids churn on quick app-switches: a 2-second flip out
// and back shouldn't tear down + re-handshake + gap-fill every channel.
const BACKGROUND_DISCONNECT_MS = 20000;
let lastAppState = AppState.currentState;
let bgDisconnectTimer = null;

AppState.addEventListener('change', (next) => {
  const prev = lastAppState;
  lastAppState = next;

  const wentToBackground = /inactive|background/.test(next);
  const cameToForeground = /inactive|background/.test(prev) && next === 'active';

  if (wentToBackground) {
    // Arm (or re-arm) the teardown. If the user comes back before it
    // fires, the foreground branch cancels it and nothing happened.
    if (bgDisconnectTimer) clearTimeout(bgDisconnectTimer);
    bgDisconnectTimer = setTimeout(() => {
      bgDisconnectTimer = null;
      try {
        supabase.realtime.disconnect();
      } catch (e) {
        console.warn('[supabase] realtime background disconnect failed:', e?.message);
      }
    }, BACKGROUND_DISCONNECT_MS);
    return;
  }

  if (cameToForeground) {
    if (bgDisconnectTimer) {
      clearTimeout(bgDisconnectTimer);
      bgDisconnectTimer = null;
    }
    try {
      supabase.realtime.connect();
    } catch (e) {
      console.warn('[supabase] realtime reconnect failed:', e?.message);
    }
  }
});
