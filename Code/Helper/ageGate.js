// Age gating for kid-safety features.
//
// Every logged-in account must supply a date of birth before the app opens
// (DateOfBirthModal, gated in App.js), so `users/{uid}/dateOfBirth` exists for
// anyone active. It is stored as the string 'YYYY-MM-DD'.
//
// Accounts under MINOR_AGE_THRESHOLD get "safe chat": private threads still
// open normally, but as soon as EITHER participant is under age both sides may
// only send vetted templates (see ChatScreen/safeTemplates.js) plus a strictly
// validated in-game username. No free text, no images.
//
// The client-side checks here are UX only. The authority is the Postgres
// BEFORE INSERT trigger in supabase/028_safe_chat_minors.sql, which re-derives
// both ages from user_identity.date_of_birth and rejects anything else — so an
// old or modified build cannot slip free text to a child.

export const MINOR_AGE_THRESHOLD = 13;

const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

// 'YYYY-MM-DD' → whole years old today, or null when unparseable/absent.
// Deliberately calendar-based (not ms/365.25) so a birthday flips exactly on
// the day, matching what the server's age() computation does.
export const ageFromDob = (dob) => {
  if (!dob || typeof dob !== 'string') return null;
  const m = DOB_RE.exec(dob.trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const now = new Date();
  let age = now.getFullYear() - year;
  // Not had this year's birthday yet → one year younger.
  const monthDiff = (now.getMonth() + 1) - month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < day)) age -= 1;

  if (age < 0 || age > 120) return null;
  return age;
};

// A DOB we cannot read is NOT treated as a minor. Two reasons:
//   1. The DOB gate guarantees a value for every active account, so a missing
//      one means a dormant legacy account — restricting every conversation
//      with them would be wrong far more often than right.
//   2. The server trigger is the real gate. It re-checks with the mirrored
//      copy, so a permissive client read cannot actually let free text reach
//      a child; it only means the sender sees a rejection instead of a
//      disabled input.
export const isMinorDob = (dob) => {
  const age = ageFromDob(dob);
  return age != null && age < MINOR_AGE_THRESHOLD;
};

// Who forced safe mode on this thread — 'both', 'me', 'them', or null when
// the conversation is unrestricted. `null`/unknown DOB on either side reads as
// not-a-minor, per isMinorDob above.
export const resolveSafeChat = (myDob, theirDob) => {
  const meMinor = isMinorDob(myDob);
  const themMinor = isMinorDob(theirDob);
  if (meMinor && themMinor) return 'both';
  if (meMinor) return 'me';
  if (themMinor) return 'them';
  return null;
};
