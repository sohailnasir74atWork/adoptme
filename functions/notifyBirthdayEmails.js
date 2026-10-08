/**
 * notifyBirthdayEmails — the birthday email (owner's call, 2026-10-08): one
 * email on the day to each player whose birthday it is, nothing else.
 *
 * Once a day it claims today's birthdays from Supabase (birthday_email_batch,
 * supabase/055: birthday is today in UTC, 13 or older, not emailed yet this
 * year; claiming marks them, so a crashed or retried run never emails anyone
 * twice), then for each player:
 *   - skips them if they turned email off (RTDB email_prefs/{uid}.optIn ===
 *     false, which the unsubscribe link also sets);
 *   - takes the address from Firebase Auth (Google, Apple or verified email);
 *   - skips Apple "Hide My Email" relay addresses until the domain is
 *     registered with Apple (they would bounce and hurt the sender score);
 *   - sends the email in their language (squad_codes.lang, else English)
 *     through Brevo (functions/birthdayEmail.js).
 *
 * Brevo's free plan allows 300 emails a day for the whole account, shared
 * with Blox Fruits (09:00 UTC, up to 120), so one run sends at most
 * MAX_SENDS. Anyone past the cap that day gets no email (never a late one).
 *
 * 08:00 UTC: the birthday's UTC date is already the local date almost
 * everywhere (03:00 in New York, 13:00 in Karachi, 18:00 in Sydney).
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');
const { renderBirthdayEmail, sendBrevo, unsubUrl, cleanName } = require('./birthdayEmail');

const CLAIM_BATCH = 100;      // also Firebase Auth's getUsers() limit
const MAX_SENDS = 150;        // Brevo's free 300/day is shared: Adopt Me 150, Blox 120, rest for tests
const CONCURRENCY = 5;
const SKIP_APPLE_RELAY = true; // until adoptmevalues.app is registered for Sign in with Apple email relay

async function langsFor(supabase, uids) {
  const out = {};
  if (!uids.length) return out;
  const { data, error } = await supabase.from('squad_codes').select('uid,lang').in('uid', uids);
  if (error) {
    console.error('[notifyBirthdayEmails] lang lookup failed:', error.message);
    return out;
  }
  for (const r of data || []) out[r.uid] = r.lang;
  return out;
}

async function emailsFor(auth, uids) {
  const out = {};
  if (!uids.length) return out;
  const res = await auth.getUsers(uids.map((uid) => ({ uid })));
  for (const u of res.users) {
    if (u.email && !u.disabled) out[u.uid] = u.email;
  }
  return out;
}

async function optedOut(db, uid) {
  const v = (await db.ref(`email_prefs/${uid}/optIn`).once('value')).val();
  return v === false;
}

// Small worker pool so one slow request doesn't hold up the rest.
async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      results.push(await fn(item));
    }
  });
  await Promise.all(workers);
  return results;
}

async function run({ db, auth, supabase, apiKey, unsubSecret }) {
  const stats = { claimed: 0, sent: 0, noEmail: 0, optedOut: 0, appleRelay: 0, failed: 0 };
  while (stats.sent < MAX_SENDS) {
    const limit = Math.min(CLAIM_BATCH, MAX_SENDS - stats.sent);
    const { data, error } = await supabase.rpc('birthday_email_batch', { p_limit: limit });
    if (error) throw new Error(`birthday_email_batch: ${error.message}`);
    const rows = (data || []).filter((r) => r && r.r_uid);
    if (!rows.length) break;
    stats.claimed += rows.length;

    const uids = rows.map((r) => r.r_uid);
    const [emails, langs] = await Promise.all([emailsFor(auth, uids), langsFor(supabase, uids)]);

    await pool(rows, CONCURRENCY, async (r) => {
      const uid = r.r_uid;
      const email = emails[uid];
      if (!email) { stats.noEmail++; return; }
      if (SKIP_APPLE_RELAY && /@privaterelay\.appleid\.com$/i.test(email)) { stats.appleRelay++; return; }
      if (await optedOut(db, uid)) { stats.optedOut++; return; }
      const lang = langs[uid];
      const unsubscribeUrl = unsubUrl(uid, lang, unsubSecret);
      const mail = renderBirthdayEmail({ name: r.r_name, gift: !!r.r_gift, lang, unsubscribeUrl });
      try {
        await sendBrevo({
          apiKey, to: email, toName: cleanName(r.r_name), unsubscribeUrl, ...mail,
        });
        stats.sent++;
      } catch (e) {
        stats.failed++;
        console.error('[notifyBirthdayEmails] send failed:', e.message);
      }
    });

    if (rows.length < limit) break;
  }
  console.log('[notifyBirthdayEmails]', JSON.stringify(stats));
  return stats;
}

exports.notifyBirthdayEmails = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BREVO_API_KEY', 'EMAIL_UNSUB_SECRET'],
    memory: '256MB',
    timeoutSeconds: 300,
  })
  .pubsub.schedule('every day 08:00')
  .timeZone('UTC')
  .onRun(() => run({
    db: admin.database(),
    auth: admin.auth(),
    supabase: getSupabaseAdmin(),
    apiKey: process.env.BREVO_API_KEY,
    unsubSecret: process.env.EMAIL_UNSUB_SECRET,
  }));

// Exposed for tests.
exports._internals = { run, MAX_SENDS };
