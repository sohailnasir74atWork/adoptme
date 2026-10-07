/**
 * notifyBirthdays — the birthday push (supabase/049_birthdays.sql).
 *
 * Once a day it claims today's birthdays from Supabase (birthday_push_batch:
 * birthday is today in UTC, account at least 30 days old, not pushed yet this
 * year; claiming marks them, so a retried or crashed run never pushes anyone
 * twice) and sends each player "Happy birthday! Your birthday pack is
 * waiting", opening the Birthdays screen. Every player gets it, whether or not
 * they show their birthday to others: it is a private message to them.
 *
 * Language: squad_codes.lang when we know it, else English. Tokens come from
 * RTDB users/{uid}/fcmToken; dead tokens are removed.
 *
 * 14:00 UTC: morning in the Americas, afternoon in Europe, evening in Asia.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

const BATCH = 500;
const MAX_BATCHES = 20;   // 10,000 a day is far above the real count (~1 in 365 accounts)

const COPY = {
  en: { title: 'Happy birthday! 🎂', body: 'Your birthday pack is waiting: 3 cards, one of them Ultra or Legendary. Open it today!' },
  ru: { title: 'С днём рождения! 🎂', body: 'Тебя ждёт праздничный набор: 3 карточки, одна из них Ultra или Legendary. Открой его сегодня!' },
  es: { title: '¡Feliz cumpleaños! 🎂', body: 'Te espera tu sobre de cumpleaños: 3 cartas, y una es Ultra o Legendaria. ¡Ábrelo hoy!' },
  fr: { title: 'Joyeux anniversaire ! 🎂', body: "Ton paquet d'anniversaire t'attend : 3 cartes, dont une Ultra ou Légendaire. Ouvre-le aujourd'hui !" },
  de: { title: 'Alles Gute zum Geburtstag! 🎂', body: 'Dein Geburtstagspack wartet: 3 Karten, eine davon Ultra oder Legendary. Öffne es heute!' },
  ar: { title: 'عيد ميلاد سعيد! 🎂', body: 'حزمة عيد ميلادك بانتظارك: 3 بطاقات، إحداها Ultra أو Legendary. افتحها اليوم!' },
  ko: { title: '생일 축하해요! 🎂', body: '생일 팩이 기다리고 있어요: 카드 3장, 그중 1장은 Ultra 또는 Legendary! 오늘 열어 보세요.' },
};

async function langsFor(supabase, uids) {
  const out = {};
  if (!uids.length) return out;
  const { data, error } = await supabase.from('squad_codes').select('uid,lang').in('uid', uids);
  if (error) {
    console.error('[notifyBirthdays] lang lookup failed:', error.message);
    return out;
  }
  for (const r of data || []) out[r.uid] = r.lang;
  return out;
}

async function sendOne(db, uid, lang) {
  const token = (await db.ref(`users/${uid}/fcmToken`).once('value')).val();
  if (!token || typeof token !== 'string') return false;
  const copy = COPY[lang] || COPY.en;
  const tag = 'birthday';
  try {
    await admin.messaging().send({
      token,
      notification: copy,
      data: { type: 'birthday', route: 'Birthdays' },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag } },
      apns: { headers: { 'apns-collapse-id': tag }, payload: { aps: { sound: 'default' } } },
    });
    return true;
  } catch (error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      await db.ref(`users/${uid}/fcmToken`).remove();
    } else {
      console.error('[notifyBirthdays] push failed:', error.code || error.message);
    }
    return false;
  }
}

async function run(db, supabase) {
  let claimed = 0;
  let sent = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await supabase.rpc('birthday_push_batch', { p_limit: BATCH });
    if (error) throw new Error(`birthday_push_batch: ${error.message}`);
    const uids = (data || []).map((r) => (typeof r === 'string' ? r : r.birthday_push_batch || r.uid)).filter(Boolean);
    if (!uids.length) break;
    claimed += uids.length;
    const langs = await langsFor(supabase, uids);
    const results = await Promise.all(uids.map((uid) => sendOne(db, uid, langs[uid]).catch(() => false)));
    sent += results.filter(Boolean).length;
    if (uids.length < BATCH) break;
  }
  console.log(`[notifyBirthdays] claimed ${claimed}, pushed ${sent}`);
  return { claimed, sent };
}

exports.notifyBirthdays = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 300,
  })
  .pubsub.schedule('every day 14:00')
  .timeZone('UTC')
  .onRun(() => run(admin.database(), getSupabaseAdmin()));

// Exposed for tests.
exports._internals = { run, COPY };
