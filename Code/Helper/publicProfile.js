/**
 * publicProfile.js — what another player may see of someone's profile.
 *
 * Reads user_profiles_public/{uid} (kept by the mirrorPublicProfile Cloud
 * Function): only pets marked "For Trade", wishes marked "Looking for", and
 * the bio. Never the whole user_profiles doc, which also holds Private pets.
 *
 * One read per profile open: the drawer's bio and portfolio loaders share
 * the same in-flight promise (60 s cache).
 */

import { doc, getDoc } from '@react-native-firebase/firestore';

const TTL_MS = 60 * 1000;
const cache = new Map(); // uid -> { at, promise }

// Same projection as functions/mirrorPublicProfile.js, for players whose
// public copy does not exist yet (before the one-time backfill).
const publicList = (arr) => (Array.isArray(arr) ? arr : [])
  .filter((p) => p && typeof p === 'object' && p.availableForTrade === true);
const project = (data) => ({
  forTrade: publicList(data?.ownedPets),
  lookingFor: publicList(data?.wishlistPets),
  bio: typeof data?.bio === 'string' && data.bio.trim() ? data.bio.trim() : null,
});

const EMPTY = { forTrade: [], lookingFor: [], bio: null };

export const getPublicProfile = (db, uid) => {
  if (!db || !uid) return Promise.resolve(EMPTY);
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const promise = (async () => {
    const pub = await getDoc(doc(db, 'user_profiles_public', uid));
    if (pub.exists()) {
      const d = pub.data() || {};
      return {
        forTrade: Array.isArray(d.forTrade) ? d.forTrade : [],
        lookingFor: Array.isArray(d.lookingFor) ? d.lookingFor : [],
        bio: typeof d.bio === 'string' ? d.bio : null,
      };
    }
    // Not mirrored yet: read the full doc once and keep only the public part.
    let full = await getDoc(doc(db, 'user_profiles', uid));
    if (!full.exists()) full = await getDoc(doc(db, 'reviews', uid));
    return full.exists() ? project(full.data()) : EMPTY;
  })();

  cache.set(uid, { at: Date.now(), promise });
  promise.catch(() => cache.delete(uid));
  return promise;
};

/** Call after the player edits their own bio or lists. */
export const invalidatePublicProfile = (uid) => cache.delete(uid);
