// Single place that configures Google Sign-In, safe to call from anywhere
// (idempotent). GlobelStats needs it BEFORE SigninDrawer mounts so a silent
// re-login can run on cold start (see GlobelStats onAuthStateChanged).
import { GoogleSignin } from '@react-native-google-signin/google-signin';

export const GOOGLE_WEB_CLIENT_ID =
  '541413670501-aj1f61kv0k9f3v515tsu3768ef9hpfjt.apps.googleusercontent.com';

let _configured = false;

export function ensureGoogleSignInConfigured() {
  if (_configured) return;
  try {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
    });
    _configured = true;
  } catch (e) {
    // Never throw from here — sign-in paths fall back to their own errors.
  }
}
