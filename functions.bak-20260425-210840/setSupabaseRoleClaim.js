/**
 * Cloud Function: Set the Supabase `role: "authenticated"` custom claim
 * on every new Firebase user at signup.
 *
 * Why: Supabase Realtime (with Third-Party Auth for Firebase) requires
 * the JWT to carry a `role` claim. Firebase ID tokens don't include one
 * by default, so without this hook, brand-new users get realtime
 * rejected with `InvalidJWTToken: Fields role and exp are required`.
 *
 * Existing users were backfilled by scripts/set-supabase-role-claim.js.
 *
 * Deployment:
 * firebase deploy --only functions:setSupabaseRoleClaim
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.setSupabaseRoleClaim = functions.auth.user().onCreate(async (user) => {
  try {
    await admin.auth().setCustomUserClaims(user.uid, { role: 'authenticated' });
    console.log(`✅ Set role=authenticated claim for new user ${user.uid}`);
  } catch (e) {
    // Don't throw — failing here would break signup for the user. Better
    // to log and let the next sign-in / migration sweep catch them.
    console.error(`❌ Failed to set role claim for ${user.uid}:`, e?.message || e);
  }
});
