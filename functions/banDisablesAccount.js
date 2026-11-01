/**
 * Cloud Function: a permanent ban also disables the Firebase Auth account
 * (2026-10-28).
 *
 * WHY
 * A ban only stopped sends: the banned account stayed signed in everywhere
 * (website included) and kept its session. Ops/bugs/LOG.md 2026-10-28
 * "Ban evasion through the website".
 *
 * WHAT IT DOES
 * On /banned_users_by_email/{emailKey}:
 *   - becomes bannedUntil === 'permanent'  -> disable the account and revoke
 *     its refresh tokens (ID tokens already issued expire within the hour),
 *     and record ban_disabled_accounts/{uid} so the unban knows we did it.
 *   - stops being permanent (unban, downgraded) -> re-enable, but only an
 *     account this function disabled, and only when no other ban node for the
 *     same email is still permanent.
 * Temporary strikes are untouched: they stay chat-only, as before.
 *
 * SAFETY
 *   - Same trust check as mirrorBansToSupabase: writes by non-staff are
 *     ignored, so nobody can disable an account by writing a ban node.
 *   - Never disables a staff or owner account.
 *   - Never claims an account that was already disabled for another reason.
 *   - ban_disabled_accounts has no rule in database.rules.json, so clients
 *     can neither read nor write it.
 *
 * Deployment:
 *   ./functions-deploy/deploy.sh banDisablesAccount
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { canonicalBanKey } = require('./_chatBanRow');
const { isTrustedWriter, STAFF_FLAGS, OWNER_EMAILS } = require('./mirrorBansToSupabase');

if (!admin.apps.length) {
  admin.initializeApp();
}

const MARKER_ROOT = 'ban_disabled_accounts';

const isPermanent = (r) => !!r && typeof r === 'object' && r.bannedUntil === 'permanent';
const decodeBanKey = (key) => String(key || '').replace(/\(dot\)/g, '.');

// record.userId is the banned account (ChatScreen/utils.js ban writers);
// fall back to the email the key encodes.
async function resolveUser(record, key) {
  const uid = record && typeof record.userId === 'string' ? record.userId : null;
  if (uid) {
    try { return await admin.auth().getUser(uid); } catch (_) { /* fall through */ }
  }
  try {
    return await admin.auth().getUserByEmail(decodeBanKey(key));
  } catch (_) {
    return null;
  }
}

async function isStaffAccount(user) {
  if (OWNER_EMAILS.has(String(user.email || '').toLowerCase())) return true;
  const db = admin.database();
  const flags = await Promise.all(
    STAFF_FLAGS.map((f) =>
      db.ref(`users/${user.uid}/${f}`).once('value')
        .then((s) => s.val() === true)
        .catch(() => true)), // unknown -> treat as staff, never disable
  );
  return flags.some(Boolean);
}

// Old builds wrote mixed-case keys; the lowercase node is canonical. Either
// one still permanent means the account stays banned.
async function stillPermanentlyBanned(rawKey, key) {
  const db = admin.database();
  const keys = Array.from(new Set([rawKey, key]));
  const snaps = await Promise.all(keys.map((k) => db.ref(`banned_users_by_email/${k}`).once('value')));
  return snaps.some((s) => isPermanent(s.val()));
}

exports.banDisablesAccount = functions
  .runWith({
    memory: '128MB',
    timeoutSeconds: 30,
  })
  .database.ref('/banned_users_by_email/{emailKey}')
  .onWrite(async (change, context) => {
    const rawKey = context.params.emailKey;
    const key = canonicalBanKey(rawKey);
    if (!key) return null;

    const before = change.before.val();
    const after = change.after.val();
    const wasPerm = isPermanent(before);
    const nowPerm = isPermanent(after);
    if (wasPerm === nowPerm) return null; // bannedAt stamps, deviceId tags, strikes

    if (!(await isTrustedWriter(context))) {
      functions.logger.warn('[banDisablesAccount] ignored change by non-staff writer', {
        key, authType: context.authType, uid: context.auth?.uid || null,
      });
      return null;
    }

    const user = await resolveUser(after || before, key);
    if (!user) {
      functions.logger.warn('[banDisablesAccount] no account for ban', { key });
      return null;
    }
    const marker = admin.database().ref(`${MARKER_ROOT}/${user.uid}`);

    try {
      if (nowPerm) {
        if (user.disabled) return null;
        if (await isStaffAccount(user)) {
          functions.logger.warn('[banDisablesAccount] staff account not disabled', { key, uid: user.uid });
          return null;
        }
        await admin.auth().updateUser(user.uid, { disabled: true });
        await admin.auth().revokeRefreshTokens(user.uid);
        await marker.set({ emailKey: key, at: admin.database.ServerValue.TIMESTAMP });
        functions.logger.info('[banDisablesAccount] disabled', { key, uid: user.uid });
        return null;
      }

      const mark = await marker.once('value');
      if (!mark.exists()) return null;
      if (await stillPermanentlyBanned(rawKey, key)) return null;
      await admin.auth().updateUser(user.uid, { disabled: false });
      await marker.remove();
      functions.logger.info('[banDisablesAccount] re-enabled', { key, uid: user.uid });
    } catch (err) {
      functions.logger.error('[banDisablesAccount] failed', { key, uid: user.uid, error: err?.message });
    }
    return null;
  });

exports.isPermanent = isPermanent;
exports.decodeBanKey = decodeBanKey;
