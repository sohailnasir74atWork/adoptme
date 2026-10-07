/**
 * Moderator ratings: the server decides which votes count.
 *
 *   mod_votes_by_user/{voterUid}/{modUid}  1 | -1   written by the voter's phone
 *   mod_votes_counted/{modUid}/{voterUid}  1 | -1   server only: votes that count
 *   mod_votes_tally/{modUid}               { ups, downs }  server only, public read
 *
 * The old mod_votes_summary counter was computed on the phone, so anyone
 * signed in could set a mod's score to any number. It is left alone for old
 * builds (HANDOFF-2026-09-29 keeps it open for them); current builds read
 * mod_votes_tally.
 *
 * A vote counts only when the voter is not currently banned or muted and the
 * account is at least MIN_ACCOUNT_AGE_MS old, so a user a mod just punished,
 * or a fresh alt account, can't drag a mod's score down. Bans and mutes are
 * the same record here (banned_users_by_email, keyed by email, legacy keys
 * not lowercased) plus device bans (banned_devices/{users/{uid}/deviceId}) —
 * the same checks GlobelStats.js uses for isUserBlocked.
 *
 * countModVote runs on every vote write. rebuildModVoteTally recounts
 * everything once a day: it fills in votes cast before this existed, drops
 * votes while their voter is banned or muted, and restores them after.
 */
const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { onSchedule } = require('firebase-functions/v2/scheduler');

if (!admin.apps.length) admin.initializeApp();

const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{6,128}$/;

const db = () => admin.database();
const isVote = (v) => v === 1 || v === -1;
const isActive = (rec, now) => {
  const until = rec && typeof rec === 'object' ? rec.bannedUntil : undefined;
  return until === 'permanent' || (typeof until === 'number' && until > now);
};
// Code/ChatScreen/utils.js encodeEmailForBan, plus the raw-case form older
// builds wrote (GlobelStats reads that one). Firebase Auth hands back the
// email lowercased, so the raw case comes from users_private/{uid}/email.
const emailKeys = (...emails) => {
  const keys = new Set();
  for (const email of emails) {
    if (typeof email !== 'string' || !email) continue;
    keys.add(email.toLowerCase().trim().replace(/\./g, '(dot)'));
    keys.add(email.replace(/\./g, '(dot)'));
  }
  return [...keys];
};
const accountOldEnough = (authUser, now) => {
  const created = Date.parse(authUser?.metadata?.creationTime || '');
  return Number.isFinite(created) && now - created >= MIN_ACCOUNT_AGE_MS;
};

async function isRestricted(uid, authUser, now) {
  const [typedEmail, fp] = await Promise.all([
    db().ref(`users_private/${uid}/email`).get().then((s) => s.val()),
    db().ref(`users/${uid}/deviceId`).get().then((s) => s.val()),
  ]);
  const reads = emailKeys(authUser?.email, typedEmail).map((k) => db().ref(`banned_users_by_email/${k}`).get());
  if (typeof fp === 'string' && DEVICE_KEY_RE.test(fp)) reads.push(db().ref(`banned_devices/${fp}`).get());
  const snaps = await Promise.all(reads);
  return snaps.some((s) => isActive(s.val(), now));
}

async function isEligible(voterUid, modUid, now) {
  if (voterUid === modUid) return false;
  const modSnap = await db().ref(`mods/${modUid}`).get();
  if (!modSnap.exists()) return false;
  let authUser;
  try {
    authUser = await admin.auth().getUser(voterUid);
  } catch (_) {
    return false; // deleted account
  }
  if (!accountOldEnough(authUser, now)) return false;
  return !(await isRestricted(voterUid, authUser, now));
}

const deltas = (prev, next) => ({
  ups: (next === 1 ? 1 : 0) - (prev === 1 ? 1 : 0),
  downs: (next === -1 ? 1 : 0) - (prev === -1 ? 1 : 0),
});

// Reads the voter's CURRENT vote rather than the event payload, so rapid
// toggles that trigger out of order still settle on the latest vote. The
// counted entry is swapped in a transaction and the tally moved by the
// difference, so two runs for the same vote never count it twice.
async function countVote(voterUid, modUid) {
  const now = Date.now();
  const latest = (await db().ref(`mod_votes_by_user/${voterUid}/${modUid}`).get()).val();
  const next = isVote(latest) && (await isEligible(voterUid, modUid, now)) ? latest : null;

  let prev = null;
  const res = await db().ref(`mod_votes_counted/${modUid}/${voterUid}`).transaction((cur) => {
    prev = isVote(cur) ? cur : null;
    return next;
  });
  if (!res.committed) return;

  const d = deltas(prev, next);
  if (d.ups || d.downs) {
    await db().ref(`mod_votes_tally/${modUid}`).update({
      ups: admin.database.ServerValue.increment(d.ups),
      downs: admin.database.ServerValue.increment(d.downs),
    });
  }
}

async function rebuildAll() {
  const now = Date.now();
  const [modsSnap, votesSnap, bannedEmailsSnap, bannedDevicesSnap] = await Promise.all([
    db().ref('mods').get(),
    db().ref('mod_votes_by_user').get(),
    db().ref('banned_users_by_email').get(),
    db().ref('banned_devices').get(),
  ]);
  const mods = modsSnap.val() || {};
  const votes = votesSnap.val() || {};

  const restrictedEmails = new Set();
  for (const [key, rec] of Object.entries(bannedEmailsSnap.val() || {})) {
    // Case-insensitive: covers the raw-case keys old builds wrote.
    if (isActive(rec, now)) restrictedEmails.add(key.toLowerCase().trim());
  }
  const restrictedDevices = new Set();
  for (const [fp, rec] of Object.entries(bannedDevicesSnap.val() || {})) {
    if (isActive(rec, now)) restrictedDevices.add(fp);
  }

  // Voters who voted on at least one current mod.
  const voters = Object.keys(votes).filter((uid) =>
    Object.keys(votes[uid] || {}).some((m) => mods[m] && m !== uid));

  const eligible = new Set();
  for (let i = 0; i < voters.length; i += 100) {
    const batch = voters.slice(i, i + 100);
    const { users } = await admin.auth().getUsers(batch.map((uid) => ({ uid })));
    const candidates = users.filter((u) =>
      accountOldEnough(u, now) && !emailKeys(u.email).some((k) => restrictedEmails.has(k.toLowerCase())));
    const fps = restrictedDevices.size
      ? await Promise.all(candidates.map((u) => db().ref(`users/${u.uid}/deviceId`).get().then((s) => s.val())))
      : [];
    candidates.forEach((u, idx) => {
      if (!restrictedDevices.has(fps[idx])) eligible.add(u.uid);
    });
  }

  const counted = {};
  const tally = {};
  for (const voter of eligible) {
    for (const [modUid, v] of Object.entries(votes[voter] || {})) {
      if (!mods[modUid] || modUid === voter || !isVote(v)) continue;
      (counted[modUid] = counted[modUid] || {})[voter] = v;
      const t = (tally[modUid] = tally[modUid] || { ups: 0, downs: 0 });
      if (v === 1) t.ups += 1; else t.downs += 1;
    }
  }

  // One write, so the tally and the counted set never disagree.
  await db().ref().update({ mod_votes_counted: counted, mod_votes_tally: tally });
  console.log(`[modVoteTally] rebuilt: ${voters.length} voters, ${eligible.size} counted, ${Object.keys(tally).length} mods`);
}

exports.countModVote = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .database.ref('/mod_votes_by_user/{voterUid}/{modUid}')
  .onWrite((change, context) => countVote(context.params.voterUid, context.params.modUid));

exports.rebuildModVoteTally = onSchedule(
  { schedule: 'every day 04:30', timeZone: 'UTC', memory: '512MiB', timeoutSeconds: 540 },
  () => rebuildAll(),
);

exports._internal = { countVote, rebuildAll, isEligible, deltas, emailKeys, MIN_ACCOUNT_AGE_MS };
