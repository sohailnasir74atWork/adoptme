/**
 * Cloud Function: runStaffElections — every 30 minutes.
 *
 * MODs and Junior Mods are elected (supabase/038_staff_elections.sql decides
 * who wins; this function only carries the result into RTDB, where the app
 * and the security rules read roles from).
 *
 *   1. Squad sizes -> RTDB /squad_size/{uid} for players with 3+ squad
 *      friends. The /users rule lets a MOD grant Trusted / CMSR / Helper only
 *      when this says 3+. notifySquadEvent writes it the moment a friend
 *      counts; this pass is the backstop and removes stale entries.
 *   2. Closed elections -> staff_finalize -> RTDB: winners get the role,
 *      everyone else holding it loses it (admins are never touched), a JMD
 *      elected MOD drops the JMD flag. Then staff_mark_applied, then a push
 *      to each winner. The first election per role replaces the hand-picked
 *      team.
 *   3. Elected holders an admin removed in RTDB get their term closed.
 *
 * Every step is idempotent: a crash part-way is finished by the next run.
 *
 * Deploy: firebase deploy --only functions:runStaffElections
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) admin.initializeApp();

const BADGE_MIN_SQUAD = 3; // keep in step with database.rules.json and 038 _staff_limits
const FLAG = { mod: 'isModerator', jmd: 'isBabyMod' };
const PAGE = 1000;

// Written per market, in the app's own words for the roles (Translation/*.json mods.*).
const COPY = {
  en: {
    mod: { title: "🛡️ You're a Moderator now!", body: 'Players voted you in. Your term runs to {date}. Tap to see your team and the MOD rules.' },
    jmd: { title: "🛡️ You're a Junior Mod now!", body: 'Players voted you in. Your term runs to {date}. Tap to see your team and the JMD rules.' },
  },
  ru: {
    mod: { title: '🛡️ Тебя выбрали модератором!', body: 'Игроки проголосовали за тебя. Срок — до {date}. Открой, чтобы увидеть команду и правила модераторов.' },
    jmd: { title: '🛡️ Тебя выбрали младшим модом!', body: 'Игроки проголосовали за тебя. Срок — до {date}. Открой, чтобы увидеть команду и правила младших модов.' },
  },
  es: {
    mod: { title: '🛡️ ¡Ya eres Moderador!', body: 'Los jugadores votaron por ti. Tu mandato dura hasta el {date}. Toca para ver a tu equipo y las reglas de MOD.' },
    jmd: { title: '🛡️ ¡Ya eres Mod junior!', body: 'Los jugadores votaron por ti. Tu mandato dura hasta el {date}. Toca para ver a tu equipo y las reglas de JMD.' },
  },
  fr: {
    mod: { title: '🛡️ Te voilà Modérateur !', body: "Les joueurs t'ont choisi. Ton mandat court jusqu'au {date}. Touche pour voir ton équipe et les règles des MOD." },
    jmd: { title: '🛡️ Te voilà Modo junior !', body: "Les joueurs t'ont choisi. Ton mandat court jusqu'au {date}. Touche pour voir ton équipe et les règles des JMD." },
  },
  de: {
    mod: { title: '🛡️ Du bist jetzt Moderator!', body: 'Die Spieler haben dich gewählt. Deine Amtszeit läuft bis {date}. Tippe für dein Team und die MOD-Regeln.' },
    jmd: { title: '🛡️ Du bist jetzt Junior-Mod!', body: 'Die Spieler haben dich gewählt. Deine Amtszeit läuft bis {date}. Tippe für dein Team und die JMD-Regeln.' },
  },
  ar: {
    mod: { title: '🛡️ أصبحت مشرفًا!', body: 'اختارك اللاعبون بأصواتهم. تستمر ولايتك حتى {date}. اضغط لترى فريقك وقواعد المشرفين.' },
    jmd: { title: '🛡️ أصبحت مشرفًا مبتدئًا!', body: 'اختارك اللاعبون بأصواتهم. تستمر ولايتك حتى {date}. اضغط لترى فريقك وقواعد المشرفين المبتدئين.' },
  },
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

async function pushWinner(db, supabase, uid, role, until) {
  try {
    const token = (await db.ref(`users/${uid}/fcmToken`).once('value')).val();
    if (!token || typeof token !== 'string') return;
    const { data } = await supabase.from('squad_codes').select('lang').eq('uid', uid).maybeSingle();
    const lang = COPY[data?.lang] ? data.lang : 'en';
    const c = COPY[lang][role];
    try {
      await admin.messaging().send({
        token,
        notification: { title: c.title, body: c.body.replace('{date}', fmtDate(until, lang)) },
        data: { type: 'elections', route: 'Elections' },
        android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag: 'elections' } },
        apns: { headers: { 'apns-collapse-id': 'elections' }, payload: { aps: { sound: 'default' } } },
      });
    } catch (error) {
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        await db.ref(`users/${uid}/fcmToken`).remove();
      } else {
        console.error('[runStaffElections] push failed:', error.code || error.message);
      }
    }
  } catch (e) {
    console.error('[runStaffElections] push error:', e.message);
  }
}

async function applyElection(db, supabase, id) {
  const { data: res, error } = await supabase.rpc('staff_finalize', { p_election: id });
  if (error) throw new Error(`staff_finalize(${id}): ${error.message}`);
  if (!res || res.skipped || res.applied) return null; // not closed, or nothing left to write

  const flag = FLAG[res.role];
  const winners = [];
  for (const uid of res.winners || []) {
    // A winner who deleted their account must not get a stub /users node.
    const exists = (await db.ref(`users/${uid}`).once('value')).exists();
    if (exists) winners.push(uid);
    else console.warn(`[runStaffElections] winner ${uid} has no /users node, skipped`);
  }
  const won = new Set(winners);
  const now = Date.now();
  const updates = {};
  const removed = [];

  const holders = await db.ref('users').orderByChild(flag).equalTo(true).once('value');
  holders.forEach((child) => {
    const u = child.val() || {};
    if (won.has(child.key) || u.admin === true || u.isAdmin === true) return;
    updates[`users/${child.key}/${flag}`] = null;
    updates[`users/${child.key}/rolesUpdatedAt`] = now;
    removed.push(child.key);
  });
  for (const uid of winners) {
    updates[`users/${uid}/${flag}`] = true;
    updates[`users/${uid}/rolesUpdatedAt`] = now;
    if (res.role === 'mod') updates[`users/${uid}/isBabyMod`] = null;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);

  const { error: markErr } = await supabase.rpc('staff_mark_applied', { p_election: id });
  if (markErr) throw new Error(`staff_mark_applied(${id}): ${markErr.message}`);
  console.log(`[runStaffElections] ${res.role} election ${id}: elected ${winners.join(', ') || '-'}; removed ${removed.join(', ') || '-'}`);

  const { data: terms } = await supabase
    .from('staff_terms').select('uid,ends_at').eq('election_id', id).is('ended_at', null);
  const until = Object.fromEntries((terms || []).map((t) => [t.uid, t.ends_at]));
  await Promise.all(winners.map((uid) => pushWinner(db, supabase, uid, res.role, until[uid])));
  return res.role;
}

// Elected holders whose RTDB flag is gone were removed by an admin.
async function closeRemovedTerms(db, supabase, skipRoles) {
  const { data, error } = await supabase.from('staff_terms').select('role,uid').is('ended_at', null);
  if (error) throw new Error(`staff_terms: ${error.message}`);
  const gone = { mod: [], jmd: [] };
  for (const t of data || []) {
    if (skipRoles.has(t.role)) continue;
    const v = (await db.ref(`users/${t.uid}/${FLAG[t.role]}`).once('value')).val();
    if (v !== true) gone[t.role].push(t.uid);
  }
  for (const role of Object.keys(gone)) {
    if (!gone[role].length) continue;
    const { error: endErr } = await supabase.rpc('staff_end_terms', { p_role: role, p_uids: gone[role], p_reason: 'removed' });
    if (endErr) console.error('[runStaffElections] staff_end_terms:', endErr.message);
    else console.log(`[runStaffElections] closed removed ${role} terms: ${gone[role].join(', ')}`);
  }
}

exports.runStaffElections = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 120,
  })
  .pubsub.schedule('every 30 minutes')
  .onRun(async () => {
    const db = admin.database();
    const supabase = getSupabaseAdmin();

    try {
      const n = await syncSquadSizes(db, supabase);
      if (n) console.log(`[runStaffElections] squad_size: ${n} change(s)`);
    } catch (e) {
      console.error('[runStaffElections] squad sync failed:', e.message);
    }

    const pending = new Set();
    try {
      const { data: due, error } = await supabase.rpc('staff_due');
      if (error) throw new Error(`staff_due: ${error.message}`);
      for (const el of due || []) {
        try {
          await applyElection(db, supabase, el.id);
        } catch (e) {
          pending.add(el.role); // retried next run; don't touch this role's terms meanwhile
          console.error('[runStaffElections] apply failed:', e.message);
        }
      }
    } catch (e) {
      console.error('[runStaffElections]', e.message);
      return null; // without the due list we can't tell which terms are safe to close
    }

    try {
      await closeRemovedTerms(db, supabase, pending);
    } catch (e) {
      console.error('[runStaffElections] term reconcile failed:', e.message);
    }
    return null;
  });

// Exposed for tests.
exports._internals = { syncSquadSizes, applyElection, closeRemovedTerms, COPY, fmtDate };
