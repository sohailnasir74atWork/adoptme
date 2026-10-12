/**
 * notifyBirthdayWishes — birthday-wish notifications (supabase/051), at most
 * TWO per birthday:
 *   1. the first wish:  "🎂 BunnyQueen wished you a happy birthday!"
 *   2. a summary 8 hours later, only if more wishes came in:
 *                       "🎉 You got 12 birthday wishes!"
 * Every 10 minutes it asks Supabase (birthday_wish_push_batch) which pushes
 * are due; claiming marks them, so a retried run never sends twice. Both open
 * the Birthdays screen. Language: squad_codes.lang, else English.
 *
 * Thank-yous (supabase/056): when a birthday player taps "Thank everyone",
 * each wisher gets ONE push per day however many players thank them:
 *                       "💖 BunnyQueen thanked you for the birthday wish!"
 *                       "💖 BunnyQueen and 3 others thanked you ..."
 * birthday_thanks_push_batch claims them the same way. Until 056 is applied
 * the batch is missing and this part is skipped.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

const BATCH = 500;

const COPY = {
  en: { first: (n) => ({ title: `🎂 ${n} wished you a happy birthday!`, body: 'Tap to see your birthday wishes.' }),
        summary: (c) => ({ title: `🎉 You got ${c} birthday wishes!`, body: 'See who celebrated you today.' }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ${n} and ${k} others thanked you for your birthday wishes!` : `💖 ${n} thanked you for the birthday wish!`, body: 'Your wish made their day.' }) },
  ru: { first: (n) => ({ title: `🎂 ${n} поздравляет тебя с днём рождения!`, body: 'Нажми, чтобы посмотреть поздравления.' }),
        summary: (c) => ({ title: `🎉 Поздравлений с днём рождения: ${c}!`, body: 'Посмотри, кто тебя поздравил.' }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ${n} и ещё ${k} благодарят тебя за поздравления!` : `💖 ${n} благодарит тебя за поздравление!`, body: 'Твоё поздравление их порадовало.' }) },
  es: { first: (n) => ({ title: `🎂 ¡${n} te felicitó por tu cumpleaños!`, body: 'Toca para ver tus felicitaciones.' }),
        summary: (c) => ({ title: `🎉 ¡Recibiste ${c} felicitaciones de cumpleaños!`, body: 'Mira quién te felicitó hoy.' }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ¡${n} y ${k} más te agradecieron tus felicitaciones!` : `💖 ¡${n} te agradeció la felicitación!`, body: 'Tu felicitación les alegró el día.' }) },
  fr: { first: (n) => ({ title: `🎂 ${n} t'a souhaité un joyeux anniversaire !`, body: 'Touche pour voir tes vœux.' }),
        summary: (c) => ({ title: `🎉 Tu as reçu ${c} vœux d'anniversaire !`, body: "Vois qui t'a fêté aujourd'hui." }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ${n} et ${k} autres te remercient pour tes vœux !` : `💖 ${n} te remercie pour ton vœu !`, body: 'Ton vœu leur a fait plaisir.' }) },
  de: { first: (n) => ({ title: `🎂 ${n} gratuliert dir zum Geburtstag!`, body: 'Tippe, um deine Glückwünsche zu sehen.' }),
        summary: (c) => ({ title: `🎉 Du hast ${c} Geburtstagsgrüße bekommen!`, body: 'Sieh nach, wer dir heute gratuliert hat.' }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ${n} und ${k} weitere bedanken sich für deine Grüße!` : `💖 ${n} bedankt sich für deinen Geburtstagsgruß!`, body: 'Dein Gruß hat ihnen den Tag versüßt.' }) },
  ar: { first: (n) => ({ title: `🎂 ${n} هنّأك بعيد ميلادك!`, body: 'اضغط لرؤية تهاني عيد ميلادك.' }),
        summary: (c) => ({ title: `🎉 وصلتك ${c} تهنئة بعيد ميلادك!`, body: 'شاهد من احتفل بك اليوم.' }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ${n} و${k} آخرون شكروك على تهانيك!` : `💖 ${n} شكرك على التهنئة!`, body: 'تهنئتك أسعدتهم.' }) },
  ko: { first: (n) => ({ title: `🎂 ${n}님이 생일을 축하했어요!`, body: '눌러서 받은 축하를 확인하세요.' }),
        summary: (c) => ({ title: `🎉 생일 축하를 ${c}개 받았어요!`, body: '오늘 누가 축하해 줬는지 확인해 보세요.' }),
        thanks: (n, k) => ({ title: k > 0 ? `💖 ${n}님 외 ${k}명이 생일 축하에 고마워해요!` : `💖 ${n}님이 생일 축하에 고마워해요!`, body: '당신의 축하가 큰 기쁨이 됐어요.' }) },
};

const cleanName = (n) => String(n || 'Someone').replace(/[\r\n]+/g, ' ').slice(0, 30);

async function langsFor(supabase, uids) {
  const out = {};
  if (!uids.length) return out;
  const { data, error } = await supabase.from('squad_codes').select('uid,lang').in('uid', uids);
  if (error) {
    console.error('[notifyBirthdayWishes] lang lookup failed:', error.message);
    return out;
  }
  for (const r of data || []) out[r.uid] = r.lang;
  return out;
}

async function sendOne(db, row, lang) {
  const token = (await db.ref(`users/${row.uid}/fcmToken`).once('value')).val();
  if (!token || typeof token !== 'string') return false;
  const copy = COPY[lang] || COPY.en;
  const notification = row.kind === 'first' ? copy.first(cleanName(row.from_name))
    : row.kind === 'thanks' ? copy.thanks(cleanName(row.from_name), row.others || 0)
      : copy.summary(row.wishes);
  const tag = row.kind === 'thanks' ? 'birthday-thanks' : 'birthday-wish';
  try {
    await admin.messaging().send({
      token,
      notification,
      data: { type: row.kind === 'thanks' ? 'birthday_thanks' : 'birthday_wish', route: 'Birthdays' },
      android: { priority: 'high', notification: { channelId: 'default', sound: 'default', tag } },
      apns: { headers: { 'apns-collapse-id': tag }, payload: { aps: { sound: 'default' } } },
    });
    return true;
  } catch (error) {
    if (error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered') {
      await db.ref(`users/${row.uid}/fcmToken`).remove();
    } else {
      console.error('[notifyBirthdayWishes] push failed:', error.code || error.message);
    }
    return false;
  }
}

const isMissingFunction = (error) =>
  !!error && (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || ''));

// 056's thank-yous: one row per wisher, { uid, from_name, others }.
async function thanksRows(supabase) {
  const { data, error } = await supabase.rpc('birthday_thanks_push_batch', { p_limit: BATCH });
  if (isMissingFunction(error)) return [];
  if (error) {
    console.error('[notifyBirthdayWishes] birthday_thanks_push_batch:', error.message);
    return [];
  }
  return (data || []).map((r) => ({ ...r, kind: 'thanks' }));
}

async function run(db, supabase) {
  const { data, error } = await supabase.rpc('birthday_wish_push_batch', { p_limit: BATCH });
  if (error) throw new Error(`birthday_wish_push_batch: ${error.message}`);
  const rows = [...(data || []), ...(await thanksRows(supabase))];
  if (!rows.length) return { claimed: 0, sent: 0 };
  const langs = await langsFor(supabase, [...new Set(rows.map((r) => r.uid))]);
  const results = await Promise.all(rows.map((r) => sendOne(db, r, langs[r.uid]).catch(() => false)));
  const sent = results.filter(Boolean).length;
  console.log(`[notifyBirthdayWishes] claimed ${rows.length}, pushed ${sent}`);
  return { claimed: rows.length, sent };
}

exports.notifyBirthdayWishes = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 120,
  })
  .pubsub.schedule('every 10 minutes')
  .onRun(() => run(admin.database(), getSupabaseAdmin()));

// Exposed for tests.
exports._internals = { run, COPY };
