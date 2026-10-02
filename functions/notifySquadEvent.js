/**
 * notifySquadEvent — HTTPS webhook: squad news for the inviter.
 *
 * Triggered by a Supabase Database Webhook (supabase/035_squad_webhook.sql):
 *   Table: public.squad_events   Event: INSERT   Method: POST
 *   Header: x-webhook-secret = <SUPABASE_WEBHOOK_SECRET>
 *
 * Kinds (written by supabase/034_squad.sql):
 *   member_joined     a friend used your code (counts after they return)
 *   member_qualified  a friend now counts in your squad
 *   reward            a milestone paid a Pro pass (036: used when the player
 *                     taps Activate, not started automatically)
 *
 * One RTDB read (the FCM token) and one send. `notification` payload (Android
 * drops data-only pushes while the app is closed); tag/collapse id `squad`
 * so a newer squad push replaces an older one on screen.
 *
 * Deploy: firebase deploy --only functions:notifySquadEvent
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const ruDays = (n) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
};
const arDays = (n) => (n >= 3 && n <= 10 ? 'أيام' : 'يومًا');

// Written per market (see LANG_BRIEF). Squad = сквад / squad / Squad / فريق.
const COPY = {
  en: {
    someone: 'A new player',
    member_joined: { title: '👥 {name} joined your squad!', body: 'They count once they come back tomorrow. Keep inviting!' },
    member_qualified: { title: '🎉 Your squad grew to {count}!', body: '{name} counts now. Invite more friends to earn Pro passes.' },
    reward: { title: '🎁 You earned a {days}-day Pro pass!', body: 'Your squad hit {count}. Use it whenever you want, it\'s waiting in Squad.' },
  },
  ru: {
    someone: 'Новый игрок',
    member_joined: { title: '👥 {name} теперь в твоём скваде!', body: 'Засчитается, когда зайдёт завтра. Зови ещё друзей!' },
    member_qualified: { title: '🎉 Твой сквад растёт: {count}!', body: '{name} теперь в счёт. Зови ещё — получишь Pro-пропуски.' },
    reward: { title: '🎁 Тебе Pro-пропуск на {days} {dayword}!', body: 'В твоём скваде уже {count}. Включай, когда удобно: пропуск ждёт в скваде.' },
  },
  es: {
    someone: 'Un jugador nuevo',
    member_joined: { title: '👥 ¡{name} se unió a tu squad!', body: 'Cuenta cuando vuelva mañana. ¡Sigue invitando!' },
    member_qualified: { title: '🎉 ¡Tu squad ya va en {count}!', body: '{name} ya cuenta. Invita a más amigos y gana pases Pro.' },
    reward: { title: '🎁 ¡Ganaste un pase Pro de {days} días!', body: 'Tu squad llegó a {count}. Úsalo cuando quieras: te espera en Squad.' },
  },
  fr: {
    someone: 'Un nouveau joueur',
    member_joined: { title: '👥 {name} a rejoint ta squad !', body: 'Ça comptera dès son retour demain. Invite encore !' },
    member_qualified: { title: '🎉 Ta squad passe à {count} !', body: '{name} compte maintenant. Invite d\'autres amis pour gagner des pass Pro.' },
    reward: { title: '🎁 Tu gagnes un pass Pro de {days} jours !', body: 'Ta squad atteint {count}. Active-le quand tu veux, il t\'attend dans Squad.' },
  },
  de: {
    someone: 'Ein neuer Spieler',
    member_joined: { title: '👥 {name} ist in deinem Squad!', body: 'Zählt, sobald die Person morgen wiederkommt. Lad weiter ein!' },
    member_qualified: { title: '🎉 Dein Squad ist jetzt {count} stark!', body: '{name} zählt jetzt. Lad mehr Freunde ein und sichere dir Pro-Pässe.' },
    reward: { title: '🎁 Du hast einen {days}-Tage-Pro-Pass!', body: 'Dein Squad hat {count} erreicht. Aktivier ihn, wann du willst – er wartet im Squad.' },
  },
  ar: {
    someone: 'لاعب جديد',
    member_joined: { title: '👥 {name} انضم إلى فريقك!', body: 'سيُحتسب عندما يعود غدًا. واصل دعوة أصدقائك!' },
    member_qualified: { title: '🎉 فريقك أصبح {count}!', body: '{name} أصبح محسوبًا الآن. ادعُ المزيد من أصدقائك واربح تذاكر Pro.' },
    reward: { title: '🎁 ربحت تذكرة Pro لمدة {days} {dayword}!', body: 'فريقك وصل إلى {count}. فعّلها وقتما تشاء، فهي بانتظارك في قسم الفريق.' },
  },
};

const clean = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function buildMessage(record) {
  const lang = COPY[record.lang] ? record.lang : 'en';
  const copy = COPY[lang];
  const tpl = copy[record.kind];
  if (!tpl) return null;
  const days = Number(record.days) || 0;
  const fill = (s) => s
    .replace('{name}', clean(record.friend_name, 40) || copy.someone)
    .replace('{count}', String(Number(record.count) || 0))
    .replace('{days}', String(days))
    .replace('{dayword}', lang === 'ru' ? ruDays(days) : lang === 'ar' ? arDays(days) : '');
  return { title: fill(tpl.title), body: fill(tpl.body) };
}

exports.buildMessage = buildMessage; // unit tests

exports.notifySquadEvent = functions
  .runWith({
    secrets: ['SUPABASE_WEBHOOK_SECRET'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }
    const expected = (process.env.SUPABASE_WEBHOOK_SECRET || '').trim();
    const got = String(req.headers['x-webhook-secret'] || '').trim();
    if (!expected || got !== expected) {
      res.status(401).send('Unauthorized');
      return;
    }
    const { type, record } = req.body || {};
    if (type !== 'INSERT' || !record || !record.recipient_uid) {
      res.status(200).send('Skipped');
      return;
    }

    // Input to the badge rule (database.rules.json): a MOD may grant Trusted /
    // CMSR / Helper only once /squad_size says 3+. runStaffElections keeps it
    // in sync too; this makes it instant. Only ever raised, so a late event
    // can't lower it.
    const squadCount = Number(record.count);
    if ((record.kind === 'member_qualified' || record.kind === 'reward') && squadCount >= 3) {
      try {
        await admin.database().ref(`squad_size/${String(record.recipient_uid)}`)
          .transaction((cur) => (typeof cur === 'number' && cur >= squadCount ? undefined : squadCount));
      } catch (e) {
        console.error('[notifySquadEvent] squad_size write failed:', e.message);
      }
    }
    const msg = buildMessage(record);
    if (!msg) {
      res.status(200).send('Unknown kind');
      return;
    }

    const toUid = String(record.recipient_uid);
    try {
      const token = (await admin.database().ref(`users/${toUid}/fcmToken`).once('value')).val();
      if (!token || typeof token !== 'string') {
        res.status(200).send('No token');
        return;
      }
      try {
        await admin.messaging().send({
          token,
          notification: msg,
          data: { type: 'squad', kind: String(record.kind), route: 'Squad' },
          android: {
            priority: 'high',
            notification: { channelId: 'default', sound: 'default', tag: 'squad' },
          },
          apns: {
            headers: { 'apns-collapse-id': 'squad' },
            payload: { aps: { sound: 'default' } },
          },
        });
      } catch (error) {
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
          await admin.database().ref(`users/${toUid}/fcmToken`).remove();
        } else {
          console.error('[notifySquadEvent] send failed:', error.code || error.message);
        }
      }
      res.status(200).send('OK');
    } catch (e) {
      console.error('[notifySquadEvent] error:', e.message);
      res.status(500).send('Error');
    }
  });
