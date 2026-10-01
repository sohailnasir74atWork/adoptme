/**
 * notifyTradeMatch — HTTPS webhook: "someone listed your dream pet".
 *
 * Triggered by a Supabase Database Webhook (see supabase/032_trade_match.sql):
 *   Table:  public.trade_match_alerts   Event: INSERT   Method: POST
 *   URL:    <this function's HTTPS URL>
 *   Header: x-webhook-secret = <SUPABASE_WEBHOOK_SECRET>
 *
 * The SQL already did the targeting and the rate limits (50 recipients per
 * listing, 1 push per recipient per 20 h, opted-out players skipped), and it
 * stamps the lister's name and the pet name on the row, so this function
 * makes one RTDB read (the recipient's FCM token) and one send.
 *
 * The push carries a `notification` block: Android drops data-only messages
 * when the app is closed (the headless service is removed on purpose), and
 * the tag / collapse id make a newer match replace an older one on screen.
 *
 * Deploy: firebase deploy --only functions:notifyTradeMatch
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Written per market, not translated (see LANG_BRIEF). Pet names stay as
// the catalogue spells them.
const COPY = {
  en: {
    title: '🎯 Your dream pet is up for trade!',
    body: '{name} has {pet} for trade. Tap to see your match.',
    someone: 'A trader',
  },
  ru: {
    title: '🎯 Твоего пета мечты выставили на трейд!',
    body: 'У {name} есть {pet} на трейд. Жми, чтобы посмотреть.',
    someone: 'одного трейдера',
  },
  es: {
    title: '🎯 ¡Tu mascota soñada está en tradeo!',
    body: '{name} tiene {pet} para tradear. Toca para ver tu match.',
    someone: 'Alguien',
  },
  fr: {
    title: '🎯 Ton animal de rêve est à échanger !',
    body: '{name} propose {pet} en échange. Touche pour voir ton match.',
    someone: 'Un joueur',
  },
  de: {
    title: '🎯 Dein Traum-Pet ist zum Traden da!',
    body: '{name} hat {pet} zum Traden. Tipp hier und sieh dir den Match an.',
    someone: 'Jemand',
  },
  ar: {
    title: '🎯 حيوانك الحلم متاح للتبادل!',
    body: '{name} يعرض {pet} للتبادل. اضغط لترى التطابق.',
    someone: 'أحد التجار',
  },
};

const clean = (s, max) => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);

function buildMessage(record) {
  const copy = COPY[record.lang] || COPY.en;
  const name = clean(record.from_name, 40) || copy.someone;
  const pet = clean(record.pet_name, 60) || '🐾';
  return {
    title: copy.title,
    body: copy.body.replace('{name}', name).replace('{pet}', pet),
  };
}

exports.buildMessage = buildMessage; // unit tests

exports.notifyTradeMatch = functions
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

    const toUid = String(record.recipient_uid);
    try {
      const tokenSnap = await admin.database().ref(`users/${toUid}/fcmToken`).once('value');
      const token = tokenSnap.val();
      if (!token || typeof token !== 'string') {
        res.status(200).send('No token');
        return;
      }

      const { title, body } = buildMessage(record);
      try {
        await admin.messaging().send({
          token,
          notification: { title, body },
          data: {
            type: 'trade_match',
            route: 'TradeMatch',
            petKey: String(record.pet_key || ''),
            fromUid: String(record.from_uid || ''),
          },
          android: {
            priority: 'high',
            notification: { channelId: 'default', sound: 'default', tag: 'trade_match' },
          },
          apns: {
            headers: { 'apns-collapse-id': 'trade_match' },
            payload: { aps: { sound: 'default' } },
          },
        });
      } catch (error) {
        if (error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered') {
          await admin.database().ref(`users/${toUid}/fcmToken`).remove();
        } else {
          console.error('[notifyTradeMatch] send failed:', error.code || error.message);
        }
      }
      res.status(200).send('OK');
    } catch (e) {
      console.error('[notifyTradeMatch] error:', e.message);
      res.status(500).send('Error');
    }
  });
