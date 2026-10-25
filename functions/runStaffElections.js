/**
 * Cloud Function: runStaffElections — every 30 minutes.
 *
 * MODs and Junior Mods are elected, and an admin has the final say
 * (supabase/038 + 040 + 041). This function never decides anything:
 *
 *   1. Squad sizes -> RTDB /squad_size/{uid} for players with 3+ squad
 *      friends. The /users rule lets a MOD grant Trusted / CMSR / Helper
 *      only when this says 3+. notifySquadEvent writes it the moment a
 *      friend counts; this pass is the backstop and removes stale entries.
 *   2. Closed elections -> staff_finalize COUNTS them (status 'counted').
 *      Nothing changes for anyone. The admins get a push: the results are
 *      waiting in Admin Dashboard → Elections.
 *   3. Admin decisions (staff_decisions, appoint / remove) -> RTDB roles,
 *      then the winner's push. The admin app writes the same flag the
 *      moment the admin taps; this is the backstop for a phone that lost
 *      its connection half-way, and it is what sends the push.
 *   4. Elected holders an admin removed in RTDB (Mod Tools) get their term
 *      closed.
 *
 * Every step is idempotent: a crash part-way is finished by the next run.
 * Nothing here opens the next election; an admin does.
 *
 * Deploy: ./functions-deploy/deploy.sh runStaffElections
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) admin.initializeApp();

const BADGE_MIN_SQUAD = 3; // keep in step with database.rules.json and 038 _staff_limits
const FLAG = { mod: 'isModerator', jmd: 'isBabyMod' };
const ROLE_LABEL = { mod: 'MOD', jmd: 'JMD' };
const PAGE = 1000;

// Written per market, in the app's own words for the roles (Translation/*.json mods.*).
const COPY = {
  en: {
    mod: { title: "🛡️ You're a Moderator now!", body: 'Players voted you in and the admins confirmed your seat. Your term runs to {date}. Tap to see your team and the MOD rules.' },
    jmd: { title: "🛡️ You're a Junior Mod now!", body: 'Players voted you in and the admins confirmed your seat. Your term runs to {date}. Tap to see your team and the JMD rules.' },
  },
  ru: {
    mod: { title: '🛡️ Тебя выбрали модератором!', body: 'Игроки проголосовали за тебя, и админы подтвердили место. Срок — до {date}. Открой, чтобы увидеть команду и правила модераторов.' },
    jmd: { title: '🛡️ Тебя выбрали младшим модом!', body: 'Игроки проголосовали за тебя, и админы подтвердили место. Срок — до {date}. Открой, чтобы увидеть команду и правила младших модов.' },
  },
  es: {
    mod: { title: '🛡️ ¡Ya eres Moderador!', body: 'Los jugadores votaron por ti y los admins confirmaron tu puesto. Tu mandato dura hasta el {date}. Toca para ver a tu equipo y las reglas de MOD.' },
    jmd: { title: '🛡️ ¡Ya eres Mod junior!', body: 'Los jugadores votaron por ti y los admins confirmaron tu puesto. Tu mandato dura hasta el {date}. Toca para ver a tu equipo y las reglas de JMD.' },
  },
  fr: {
    mod: { title: '🛡️ Te voilà Modérateur !', body: "Les joueurs t'ont choisi et les admins ont confirmé ton siège. Ton mandat court jusqu'au {date}. Touche pour voir ton équipe et les règles des MOD." },
    jmd: { title: '🛡️ Te voilà Modo junior !', body: "Les joueurs t'ont choisi et les admins ont confirmé ton siège. Ton mandat court jusqu'au {date}. Touche pour voir ton équipe et les règles des JMD." },
  },
  de: {
    mod: { title: '🛡️ Du bist jetzt Moderator!', body: 'Die Spieler haben dich gewählt und die Admins haben es bestätigt. Deine Amtszeit läuft bis {date}. Tippe für dein Team und die MOD-Regeln.' },
    jmd: { title: '🛡️ Du bist jetzt Junior-Mod!', body: 'Die Spieler haben dich gewählt und die Admins haben es bestätigt. Deine Amtszeit läuft bis {date}. Tippe für dein Team und die JMD-Regeln.' },
  },
  ar: {
    mod: { title: '🛡️ أصبحت مشرفًا!', body: 'اختارك اللاعبون بأصواتهم وأكدت الإدارة مقعدك. تستمر ولايتك حتى {date}. اضغط لترى فريقك وقواعد المشرفين.' },
    jmd: { title: '🛡️ أصبحت مشرفًا مبتدئًا!', body: 'اختارك اللاعبون بأصواتهم وأكدت الإدارة مقعدك. تستمر ولايتك حتى {date}. اضغط لترى فريقك وقواعد المشرفين المبتدئين.' },
  },
};

// Staff tools stay English.
const adminCopy = (res) => {
  const n = Array.isArray(res.qualified) ? res.qualified.length : 0;
  const label = ROLE_LABEL[res.role] || res.role;
  return {
    title: `🗳️ ${label} election closed`,
    body: n === 0
      ? `Nobody reached ${res.minVotes} votes (${res.candidates || 0} on the ballot, ${res.turnout || 0} votes cast). Review it in Admin Dashboard → Elections.`
      : `${n} of ${res.candidates || 0} candidates reached ${res.minVotes} votes for ${res.seats} seats (${res.turnout || 0} votes cast). Nothing changes until you decide: Admin Dashboard → Elections.`,
  };
};

const fmtDate = (iso, lang) => {
  try {
    return new Date(iso).toLocaleDateString(lang === 'ar' ? 'ar' : lang, { day: 'numeric', month: 'long' });
  } catch (e) {
    return String(iso).slice(0, 10);
  }
};

async function syncSquadSizes(db, supabase) {
  const want = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('squad_codes')
      .select('uid,direct_count')
      .gte('direct_count', BADGE_MIN_SQUAD)
      .order('uid')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`squad_codes: ${error.message}`);
    for (const r of data || []) want[r.uid] = r.direct_count;
    if (!data || data.length < PAGE) break;
  }
  const have = (await db.ref('squad_size').once('value')).val() || {};
  const updates = {};
  for (const [uid, n] of Object.entries(want)) if (have[uid] !== n) updates[uid] = n;
  for (const uid of Object.keys(have)) if (!(uid in want)) updates[uid] = null;
  const n = Object.keys(updates).length;
  if (n) await db.ref('squad_size').update(updates);
  return n;
}

// Send one push; a dead token is removed so it is not retried forever.
async function sendPush(db, uid, token, notification, tag) {
  try {
    await admin.messaging().send({
      token,
      notification,
      data: { type: 'elections', route: 'Elections' },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag } },
      apns: { headers: { 'apns-collapse-id': tag }, payload: { aps: { sound: 'default' } } },
    });
    return true;
  } catch (error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      await db.ref(`users/${uid}/fcmToken`).remove();
    } else {
      console.error('[runStaffElections] push failed:', error.code || error.message);
    }
    return false;
  }
}

async function pushWinner(db, supabase, uid, role, until) {
  try {
    const token = (await db.ref(`users/${uid}/fcmToken`).once('value')).val();
    if (!token || typeof token !== 'string') return;
    const { data } = await supabase.from('squad_codes').select('lang').eq('uid', uid).maybeSingle();
    const lang = COPY[data?.lang] ? data.lang : 'en';
    const c = COPY[lang][role];
    await sendPush(db, uid, token, { title: c.title, body: c.body.replace('{date}', fmtDate(until, lang)) }, 'elections');
  } catch (e) {
    console.error('[runStaffElections] push error:', e.message);
  }
}

// Every admin with a token hears that a count is waiting for them.
async function pushAdmins(db, res) {
  let sent = 0;
  try {
    const snap = await db.ref('users').orderByChild('admin').equalTo(true).once('value');
    const admins = [];
    snap.forEach((child) => {
      const token = (child.val() || {}).fcmToken;
      if (token && typeof token === 'string') admins.push({ uid: child.key, token });
    });
    const copy = adminCopy(res);
    for (const a of admins) {
      if (await sendPush(db, a.uid, a.token, copy, 'elections-admin')) sent++;
    }
  } catch (e) {
    console.error('[runStaffElections] admin push error:', e.message);
  }
  return sent;
}

// Count every election that has closed. Seats do not move here.
async function countDue(db, supabase) {
  const { data: due, error } = await supabase.rpc('staff_due');
  if (error) throw new Error(`staff_due: ${error.message}`);
  const counted = [];
  for (const el of due || []) {
    try {
      const { data: res, error: finErr } = await supabase.rpc('staff_finalize', { p_election: el.id });
      if (finErr) throw new Error(`staff_finalize(${el.id}): ${finErr.message}`);
      if (!res || !res.counted) continue; // already counted, or not closed after all
      const n = Array.isArray(res.qualified) ? res.qualified.length : 0;
      console.log(`[runStaffElections] ${res.role} election ${res.id} counted: ${n} qualified of ${res.candidates}, ${res.turnout} votes; waiting for an admin`);
      const sent = await pushAdmins(db, res);
      counted.push({ id: res.id, role: res.role, qualified: n, adminsNotified: sent });
    } catch (e) {
      console.error('[runStaffElections] count failed:', e.message);
    }
  }
  return counted;
}

// Write the admin's decisions into RTDB and push the winners.
async function applyDecisions(db, supabase) {
  const { data: pending, error } = await supabase.rpc('staff_pending_apply');
  if (error) throw new Error(`staff_pending_apply: ${error.message}`);
  const done = [];
  for (const d of pending || []) {
    const flag = FLAG[d.role];
    if (!flag || (d.kind !== 'appoint' && d.kind !== 'remove')) continue;
    try {
      const userSnap = await db.ref(`users/${d.uid}`).once('value');
      const exists = userSnap.exists();
      if (!d.appliedAt) {
        if (exists) {
          const now = Date.now();
          const updates = { [`users/${d.uid}/${flag}`]: d.kind === 'appoint' ? true : null, [`users/${d.uid}/rolesUpdatedAt`]: now };
          // A JMD appointed MOD leaves the JMD seat.
          if (d.kind === 'appoint' && d.role === 'mod') updates[`users/${d.uid}/isBabyMod`] = null;
          await db.ref().update(updates);
        } else {
          // A player who deleted their account must not get a stub /users node.
          console.warn(`[runStaffElections] ${d.kind} ${d.role} ${d.uid}: no /users node, nothing written`);
        }
        const { error: markErr } = await supabase.rpc('staff_decision_applied', { p_id: d.id });
        if (markErr) throw new Error(`staff_decision_applied(${d.id}): ${markErr.message}`);
        console.log(`[runStaffElections] ${d.kind} ${d.role} ${d.uid} applied (election ${d.electionId})`);
      }
      if (d.kind === 'appoint' && !d.notifiedAt) {
        if (exists) await pushWinner(db, supabase, d.uid, d.role, d.until);
        const { error: noteErr } = await supabase.rpc('staff_decision_notified', { p_id: d.id });
        if (noteErr) throw new Error(`staff_decision_notified(${d.id}): ${noteErr.message}`);
      }
      done.push({ id: d.id, uid: d.uid, kind: d.kind, role: d.role });
    } catch (e) {
      console.error('[runStaffElections] apply failed:', e.message); // retried next run
    }
  }
  return done;
}

// Elected holders whose RTDB flag is gone were removed by an admin (Mod Tools).
async function closeRemovedTerms(db, supabase) {
  const { data, error } = await supabase.rpc('staff_terms_open');
  if (error) throw new Error(`staff_terms_open: ${error.message}`);
  const gone = { mod: [], jmd: [] };
  for (const t of data || []) {
    if (!FLAG[t.role]) continue;
    const v = (await db.ref(`users/${t.uid}/${FLAG[t.role]}`).once('value')).val();
    if (v !== true) gone[t.role].push(t.uid);
  }
  for (const role of Object.keys(gone)) {
    if (!gone[role].length) continue;
    const { error: endErr } = await supabase.rpc('staff_end_terms', { p_role: role, p_uids: gone[role], p_reason: 'removed' });
    if (endErr) console.error('[runStaffElections] staff_end_terms:', endErr.message);
    else console.log(`[runStaffElections] closed removed ${role} terms: ${gone[role].join(', ')}`);
  }
  return gone;
}

async function run(db, supabase) {
  try {
    const n = await syncSquadSizes(db, supabase);
    if (n) console.log(`[runStaffElections] squad_size: ${n} change(s)`);
  } catch (e) {
    console.error('[runStaffElections] squad sync failed:', e.message);
  }

  try {
    await countDue(db, supabase);
  } catch (e) {
    console.error('[runStaffElections]', e.message);
  }

  try {
    await applyDecisions(db, supabase);
  } catch (e) {
    console.error('[runStaffElections] apply pass failed:', e.message);
  }

  try {
    await closeRemovedTerms(db, supabase);
  } catch (e) {
    console.error('[runStaffElections] term reconcile failed:', e.message);
  }
  return null;
}

exports.runStaffElections = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 120,
  })
  .pubsub.schedule('every 30 minutes')
  .onRun(() => run(admin.database(), getSupabaseAdmin()));

// Exposed for tests.
exports._internals = { run, syncSquadSizes, countDue, applyDecisions, closeRemovedTerms, pushAdmins, adminCopy, COPY, fmtDate, FLAG };
