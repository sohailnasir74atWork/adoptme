/**
 * mirrorPublicProfile — keeps user_profiles_public/{uid} in step with
 * user_profiles/{uid}.
 *
 * user_profiles holds a player's WHOLE inventory and wishlist, including pets
 * they marked Private. Other players' phones used to download that whole doc
 * to show the profile portfolio and simply hide the private pets on screen.
 * The app now reads only this public projection:
 *   forTrade   = owned pets marked "For Trade"      (availableForTrade === true)
 *   lookingFor = wishlist pets marked "Looking for" (availableForTrade === true)
 *   bio
 * Written server-side on every change, so it is right for players on any app
 * version. Skips the write when the public part did not change (most saves
 * only touch private pets or updatedAt).
 *
 * Once user_profiles is locked to its owner in the Firestore rules, this is
 * the only way other players can see someone's portfolio.
 *
 * Deploy: firebase deploy --only functions:mirrorPublicProfile
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const PET_FIELDS = [
  'name', 'Name', 'value', 'valueType', 'isFly', 'isRide', 'imageUrl',
  'category', 'id', 'valueSource', 'valueUnit', 'ggCategory',
];
const MAX_PETS = 300;

const pickPet = (p) => {
  const out = { availableForTrade: true };
  for (const k of PET_FIELDS) if (p[k] !== undefined) out[k] = p[k];
  return out;
};

const publicList = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((p) => p && typeof p === 'object' && p.availableForTrade === true)
  .slice(0, MAX_PETS)
  .map(pickPet);

/** The public part of a user_profiles doc (null when there is no doc). */
function projectPublic(data) {
  if (!data) return null;
  return {
    forTrade: publicList(data.ownedPets),
    lookingFor: publicList(data.wishlistPets),
    bio: typeof data.bio === 'string' && data.bio.trim() ? data.bio.trim().slice(0, 500) : null,
  };
}

exports.projectPublic = projectPublic; // unit tests + backfill

exports.mirrorPublicProfile = functions
  .runWith({ memory: '256MB', timeoutSeconds: 30 })
  .firestore.document('user_profiles/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const ref = admin.firestore().doc(`user_profiles_public/${uid}`);
    const after = change.after.exists ? projectPublic(change.after.data()) : null;

    if (!after) {
      await ref.delete().catch(() => {});
      return null;
    }
    const before = change.before.exists ? projectPublic(change.before.data()) : null;
    if (before && JSON.stringify(before) === JSON.stringify(after)) return null;

    await ref.set({ ...after, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return null;
  });
