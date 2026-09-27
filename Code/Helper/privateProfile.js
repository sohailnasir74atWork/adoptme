// Private profile — a user's email and date of birth, kept OFF users/{uid}.
//
// users/{uid} can be read one record at a time by anyone (database.rules.json),
// so an email or date of birth stored there is public. Since round 2
// (2026-09) both live in RTDB users_private/{uid}:
//
//   { email: 'lowercased auth email', dateOfBirth?: 'YYYY-MM-DD' }
//
// Rules: the owner reads and writes their own node (email must equal their
// auth token's email, lowercased; dateOfBirth is write-once and neither field
// can be deleted by the client); staff read every node and can query it by
// email. Nobody else can read it. mirrorUsersPrivateToSupabase copies it to
// Supabase user_identity_base, where the user_identity view masks it the
// same way (supabase/031_private_identity.sql).
//
// LEGACY: until scripts/migrate-user-pii.js has run, most accounts still carry
// users/{uid}/email (app: raw, web: '.' → ',') and decodedEmail (app:
// '.' → '(dot)', web: raw), plus users/{uid}/dateOfBirth. The readers below
// fall back to those so moderation keeps working before and after the
// migration. After cutover privatizeUserPII moves any copy an old build writes
// back, so the fallback only ever finds pre-migration data.
import { ref, get, update, query, orderByChild, equalTo, limitToFirst } from '@react-native-firebase/database';

const DOB_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// Any stored form of an address → 'name@domain.tld', lowercased. null when it
// isn't recognisably an email.
export const normalizeEmail = (value) => {
  if (typeof value !== 'string') return null;
  const email = value.trim().replace(/\(dot\)/g, '.').replace(/,/g, '.').toLowerCase();
  return email.includes('@') ? email : null;
};

// One leaf, or null on missing / denied / offline. Callers only ever want
// "the value if we can have it".
const readValue = async (db, path) => {
  try {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
  } catch (_) {
    return null;
  }
};

const readLegacyEmail = async (db, uid) =>
  normalizeEmail(await readValue(db, `users/${uid}/email`)) ||
  normalizeEmail(await readValue(db, `users/${uid}/decodedEmail`));

// Another user's email, for moderation. Staff-only in practice: users_private
// is unreadable to everyone else, so for them this only ever sees legacy data.
export const getUserEmail = async (db, uid) => {
  if (!db || !uid) return null;
  return normalizeEmail(await readValue(db, `users_private/${uid}/email`)) || readLegacyEmail(db, uid);
};

// { email, dateOfBirth } for one user — your own, or anyone's if you are staff.
// One read of the private node; legacy leaves are read only for what it lacks.
export const getPrivateProfile = async (db, uid) => {
  if (!db || !uid) return { email: null, dateOfBirth: null };
  const priv = (await readValue(db, `users_private/${uid}`)) || {};
  const email = normalizeEmail(priv.email) || (await readLegacyEmail(db, uid));
  let dateOfBirth = typeof priv.dateOfBirth === 'string' ? priv.dateOfBirth : null;
  if (!dateOfBirth) {
    const legacy = await readValue(db, `users/${uid}/dateOfBirth`);
    dateOfBirth = typeof legacy === 'string' ? legacy : null;
  }
  return { email, dateOfBirth };
};

// Staff email search: exact match on the lowercased address, served by the
// `.indexOn: ["email"]` on users_private. Returns [{ uid, email }].
export const findUsersByEmail = async (db, text, limit = 10) => {
  const email = normalizeEmail(text);
  if (!db || !email) return [];
  try {
    const snap = await get(query(ref(db, 'users_private'), orderByChild('email'), equalTo(email), limitToFirst(limit)));
    if (!snap.exists()) return [];
    return Object.entries(snap.val() || {}).map(([uid, v]) => ({ uid, email: normalizeEmail(v?.email) || email }));
  } catch (e) {
    console.warn('[privateProfile] email search failed:', e?.message);
    return [];
  }
};

// Write the signed-in user's own email and/or date of birth to
// users_private/{uid}. Each field is its own update(): the rules judge them
// separately (email must match the auth token, DOB is write-once), and one
// rejected field must not take the other down with it.
// Never throws. Resolves true only if every requested write landed.
export const saveOwnPrivateProfile = async (db, uid, { email, dateOfBirth } = {}) => {
  if (!db || !uid) return false;
  const nodeRef = ref(db, `users_private/${uid}`);
  const writes = [];
  if (typeof email === 'string' && email.trim()) {
    writes.push(update(nodeRef, { email: email.trim().toLowerCase() }));
  }
  if (typeof dateOfBirth === 'string' && DOB_RE.test(dateOfBirth)) {
    writes.push(update(nodeRef, { dateOfBirth }));
  }
  if (writes.length === 0) return false;
  const results = await Promise.allSettled(writes);
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => console.warn('[privateProfile] save failed:', r.reason?.message));
  return failed.length === 0;
};
