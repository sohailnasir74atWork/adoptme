/**
 * birthdayEmail.js — the birthday email itself, shared by
 * notifyBirthdayEmails.js (the daily send), emailUnsubscribe.js (the
 * unsubscribe page) and scripts/birthdays/send-test-email.js.
 *
 * Sent through Brevo's transactional API from the authenticated domain
 * adoptmevalues.app. Copy is written per language (not translated word for
 * word), in the app's own terms ("pack" is "booster" in French and German,
 * "sobre" in Spanish...). Arabic renders right to left.
 *
 * Every email carries a one-click unsubscribe (RFC 8058 List-Unsubscribe
 * headers plus a footer link). The link is signed with EMAIL_UNSUB_SECRET so
 * nobody can unsubscribe someone else.
 */

const crypto = require('crypto');

const SENDER = { name: 'Adopt Me Values', email: 'hello@adoptmevalues.app' };
const APP_URL = 'https://www.adoptmevalues.app/app?utm_source=brevo&utm_medium=email&utm_campaign=birthday';
const UNSUB_BASE = 'https://us-central1-adoptme-7b50c.cloudfunctions.net/emailUnsubscribe';
// Required by anti-spam law (CAN-SPAM): a real postal address in every email.
const POSTAL_ADDRESS = 'The Solana Labs · 27 E/45, POF, Wah Cantt 47040, Pakistan';
const LANGS = ['en', 'ru', 'es', 'fr', 'de', 'ar', 'ko'];

const COPY = {
  en: {
    subjectNamedGift: 'Happy birthday, {{name}}! 🎂 Your birthday pack is waiting',
    subjectGift: 'Happy birthday! 🎂 Your birthday pack is waiting',
    subjectNamed: 'Happy birthday, {{name}}! 🎂',
    subject: 'Happy birthday! 🎂',
    preheaderGift: '3 cards, and one of them is Ultra or Legendary. Open it today!',
    preheader: 'Have an amazing day from all of us at Adopt Me Values.',
    titleNamed: 'Happy birthday, {{name}}! 🎉',
    title: 'Happy birthday! 🎉',
    gift: 'Your birthday pack is waiting in the app: 3 cards, and one of them is Ultra or Legendary. Open it today!',
    noGift: 'Have an amazing day! Players can send you birthday wishes in the app today.',
    buttonGift: 'Open my birthday pack',
    button: 'Open the app',
    signoff: 'Have a great birthday!',
    team: 'The Adopt Me Values team',
    why: "You got this email because it's your birthday and you have an Adopt Me Values account. We send it once a year, on your birthday.",
    unsubscribe: 'Unsubscribe',
    disclaimer: 'Fan-made app · not affiliated with Uplift Games or Roblox',
  },
  ru: {
    subjectNamedGift: 'С днём рождения, {{name}}! 🎂 Тебя ждёт праздничный набор',
    subjectGift: 'С днём рождения! 🎂 Тебя ждёт праздничный набор',
    subjectNamed: 'С днём рождения, {{name}}! 🎂',
    subject: 'С днём рождения! 🎂',
    preheaderGift: '3 карточки, и одна из них Ultra или Legendary. Открой его сегодня!',
    preheader: 'Отличного тебе дня от всей команды Adopt Me Values!',
    titleNamed: 'С днём рождения, {{name}}! 🎉',
    title: 'С днём рождения! 🎉',
    gift: 'В приложении тебя ждёт праздничный набор: 3 карточки, и одна из них Ultra или Legendary. Открой его сегодня!',
    noGift: 'Желаем отличного дня! Сегодня другие игроки могут поздравить тебя прямо в приложении.',
    buttonGift: 'Открыть праздничный набор',
    button: 'Открыть приложение',
    signoff: 'С праздником!',
    team: 'Команда Adopt Me Values',
    why: 'Это письмо пришло тебе, потому что сегодня твой день рождения и у тебя есть аккаунт в Adopt Me Values. Мы пишем раз в год, в твой день рождения.',
    unsubscribe: 'Отписаться',
    disclaimer: 'Фан-проект · не связан с Uplift Games и Roblox',
  },
  es: {
    subjectNamedGift: '¡Feliz cumpleaños, {{name}}! 🎂 Tu sobre de cumpleaños te espera',
    subjectGift: '¡Feliz cumpleaños! 🎂 Tu sobre de cumpleaños te espera',
    subjectNamed: '¡Feliz cumpleaños, {{name}}! 🎂',
    subject: '¡Feliz cumpleaños! 🎂',
    preheaderGift: '3 cartas, y una es Ultra o Legendaria. ¡Ábrelo hoy!',
    preheader: 'Todo el equipo de Adopt Me Values te desea un día increíble.',
    titleNamed: '¡Feliz cumpleaños, {{name}}! 🎉',
    title: '¡Feliz cumpleaños! 🎉',
    gift: 'En la app te espera tu sobre de cumpleaños: 3 cartas, y una de ellas es Ultra o Legendaria. ¡Ábrelo hoy!',
    noGift: '¡Que tengas un día increíble! Hoy otros jugadores pueden felicitarte en la app.',
    buttonGift: 'Abrir mi sobre de cumpleaños',
    button: 'Abrir la app',
    signoff: '¡Que lo disfrutes!',
    team: 'El equipo de Adopt Me Values',
    why: 'Te llegó este correo porque hoy es tu cumpleaños y tienes una cuenta en Adopt Me Values. Lo enviamos una vez al año, el día de tu cumpleaños.',
    unsubscribe: 'Cancelar suscripción',
    disclaimer: 'Hecho por fans · sin relación con Uplift Games ni Roblox',
  },
  fr: {
    subjectNamedGift: "Joyeux anniversaire, {{name}} ! 🎂 Ton booster d'anniversaire t'attend",
    subjectGift: "Joyeux anniversaire ! 🎂 Ton booster d'anniversaire t'attend",
    subjectNamed: 'Joyeux anniversaire, {{name}} ! 🎂',
    subject: 'Joyeux anniversaire ! 🎂',
    preheaderGift: "3 cartes, dont une Ultra ou Légendaire. Ouvre-le aujourd'hui !",
    preheader: "Toute l'équipe d'Adopt Me Values te souhaite une super journée.",
    titleNamed: 'Joyeux anniversaire, {{name}} ! 🎉',
    title: 'Joyeux anniversaire ! 🎉',
    gift: "Ton booster d'anniversaire t'attend dans l'appli : 3 cartes, dont une Ultra ou Légendaire. Ouvre-le aujourd'hui !",
    noGift: "Passe une super journée ! Aujourd'hui, les autres joueurs peuvent te souhaiter ton anniversaire dans l'appli.",
    buttonGift: "Ouvrir mon booster d'anniversaire",
    button: "Ouvrir l'appli",
    signoff: 'Profite bien de ta journée !',
    team: "L'équipe Adopt Me Values",
    why: "Tu reçois cet e-mail parce que c'est ton anniversaire et que tu as un compte Adopt Me Values. On l'envoie une fois par an, le jour de ton anniversaire.",
    unsubscribe: 'Se désabonner',
    disclaimer: 'Création de fans · aucun lien avec Uplift Games ni Roblox',
  },
  de: {
    subjectNamedGift: 'Alles Gute zum Geburtstag, {{name}}! 🎂 Dein Geburtstags-Booster wartet',
    subjectGift: 'Alles Gute zum Geburtstag! 🎂 Dein Geburtstags-Booster wartet',
    subjectNamed: 'Alles Gute zum Geburtstag, {{name}}! 🎂',
    subject: 'Alles Gute zum Geburtstag! 🎂',
    preheaderGift: '3 Karten, eine davon Ultra oder Legendary. Öffne ihn heute!',
    preheader: 'Das ganze Team von Adopt Me Values wünscht dir einen tollen Tag.',
    titleNamed: 'Alles Gute zum Geburtstag, {{name}}! 🎉',
    title: 'Alles Gute zum Geburtstag! 🎉',
    gift: 'In der App wartet dein Geburtstags-Booster: 3 Karten, eine davon Ultra oder Legendary. Öffne ihn heute!',
    noGift: 'Hab einen tollen Tag! Heute können dir andere Spieler in der App gratulieren.',
    buttonGift: 'Geburtstags-Booster öffnen',
    button: 'App öffnen',
    signoff: 'Feier schön!',
    team: 'Dein Adopt Me Values Team',
    why: 'Du bekommst diese E-Mail, weil heute dein Geburtstag ist und du ein Konto bei Adopt Me Values hast. Wir schicken sie einmal im Jahr, an deinem Geburtstag.',
    unsubscribe: 'Abmelden',
    disclaimer: 'Fan-Projekt · keine Verbindung zu Uplift Games oder Roblox',
  },
  ar: {
    subjectNamedGift: 'عيد ميلاد سعيد يا {{name}}! 🎂 حزمة عيد ميلادك بانتظارك',
    subjectGift: 'عيد ميلاد سعيد! 🎂 حزمة عيد ميلادك بانتظارك',
    subjectNamed: 'عيد ميلاد سعيد يا {{name}}! 🎂',
    subject: 'عيد ميلاد سعيد! 🎂',
    preheaderGift: '3 بطاقات، إحداها Ultra أو Legendary. افتحها اليوم!',
    preheader: 'فريق Adopt Me Values كله يتمنى لك يومًا رائعًا.',
    titleNamed: 'عيد ميلاد سعيد يا {{name}}! 🎉',
    title: 'عيد ميلاد سعيد! 🎉',
    gift: 'حزمة عيد ميلادك بانتظارك في التطبيق: 3 بطاقات، وإحداها Ultra أو Legendary. افتحها اليوم!',
    noGift: 'نتمنى لك يومًا رائعًا! يستطيع اللاعبون اليوم تهنئتك بعيد ميلادك داخل التطبيق.',
    buttonGift: 'افتح حزمة عيد ميلادي',
    button: 'افتح التطبيق',
    signoff: 'كل عام وأنت بخير!',
    team: 'فريق Adopt Me Values',
    why: 'وصلتك هذه الرسالة لأن اليوم عيد ميلادك ولديك حساب في Adopt Me Values. نرسلها مرة واحدة في السنة، في يوم عيد ميلادك.',
    unsubscribe: 'إلغاء الاشتراك',
    disclaimer: 'من صنع المعجبين · لا علاقة له بـ Uplift Games أو Roblox',
  },
  ko: {
    subjectNamedGift: '{{name}}님, 생일 축하해요! 🎂 생일 카드팩이 기다리고 있어요',
    subjectGift: '생일 축하해요! 🎂 생일 카드팩이 기다리고 있어요',
    subjectNamed: '{{name}}님, 생일 축하해요! 🎂',
    subject: '생일 축하해요! 🎂',
    preheaderGift: '카드 3장, 그중 1장은 Ultra 또는 Legendary! 오늘 열어 보세요.',
    preheader: 'Adopt Me Values 팀 모두가 멋진 하루를 응원해요.',
    titleNamed: '{{name}}님, 생일 축하해요! 🎉',
    title: '생일 축하해요! 🎉',
    gift: '앱에서 생일 카드팩이 기다리고 있어요. 카드 3장 중 1장은 Ultra 또는 Legendary예요. 오늘 꼭 열어 보세요!',
    noGift: '멋진 하루 보내세요! 오늘은 다른 플레이어들이 앱에서 생일 축하를 보낼 수 있어요.',
    buttonGift: '생일 카드팩 열기',
    button: '앱 열기',
    signoff: '행복한 생일 보내세요!',
    team: 'Adopt Me Values 팀',
    why: '오늘이 생일이고 Adopt Me Values 계정이 있어서 이 메일을 보냈어요. 1년에 한 번, 생일에만 보내요.',
    unsubscribe: '수신 거부',
    disclaimer: '팬 제작 · Uplift Games, 로블록스와 관계없음',
  },
};

// The unsubscribe page (emailUnsubscribe.js).
const PAGE = {
  en: { confirmTitle: 'Unsubscribe from Adopt Me Values emails?', confirmBody: "We'll stop sending emails to this address.", confirm: 'Unsubscribe', doneTitle: "You're unsubscribed", doneBody: "You won't get emails from Adopt Me Values anymore. You can turn them back on in the app: Settings → Email updates.", bad: "This link isn't valid. Please use the link in your email." },
  ru: { confirmTitle: 'Отписаться от писем Adopt Me Values?', confirmBody: 'Мы больше не будем писать на этот адрес.', confirm: 'Отписаться', doneTitle: 'Ты отписан(а)', doneBody: 'Письма от Adopt Me Values больше не придут. Включить их снова можно в приложении: Настройки → Новости на почту.', bad: 'Ссылка недействительна. Открой ссылку из письма.' },
  es: { confirmTitle: '¿Cancelar los correos de Adopt Me Values?', confirmBody: 'Dejaremos de enviar correos a esta dirección.', confirm: 'Cancelar suscripción', doneTitle: 'Listo, ya no recibirás correos', doneBody: 'No te llegarán más correos de Adopt Me Values. Puedes volver a activarlos en la app: Ajustes → Novedades por correo.', bad: 'Este enlace no es válido. Usa el enlace de tu correo.' },
  fr: { confirmTitle: 'Se désabonner des e-mails Adopt Me Values ?', confirmBody: "Nous n'enverrons plus d'e-mails à cette adresse.", confirm: 'Se désabonner', doneTitle: 'Tu es désabonné(e)', doneBody: "Tu ne recevras plus d'e-mails d'Adopt Me Values. Tu peux les réactiver dans l'appli : Paramètres → Actus par e-mail.", bad: "Ce lien n'est pas valide. Utilise le lien de ton e-mail." },
  de: { confirmTitle: 'E-Mails von Adopt Me Values abbestellen?', confirmBody: 'Wir schicken keine E-Mails mehr an diese Adresse.', confirm: 'Abmelden', doneTitle: 'Du bist abgemeldet', doneBody: 'Du bekommst keine E-Mails mehr von Adopt Me Values. In der App kannst du sie wieder einschalten: Einstellungen → E-Mail-Updates.', bad: 'Dieser Link ist ungültig. Nutze bitte den Link aus deiner E-Mail.' },
  ar: { confirmTitle: 'إلغاء الاشتراك في رسائل Adopt Me Values؟', confirmBody: 'لن نرسل بعد الآن أي رسائل إلى هذا العنوان.', confirm: 'إلغاء الاشتراك', doneTitle: 'تم إلغاء اشتراكك', doneBody: 'لن تصلك رسائل من Adopt Me Values بعد الآن. يمكنك تفعيلها من جديد في التطبيق: الإعدادات ← التحديثات عبر البريد.', bad: 'هذا الرابط غير صالح. استخدم الرابط الموجود في رسالتك.' },
  ko: { confirmTitle: 'Adopt Me Values 메일 수신을 거부할까요?', confirmBody: '이 주소로 더 이상 메일을 보내지 않아요.', confirm: '수신 거부', doneTitle: '수신 거부되었어요', doneBody: '이제 Adopt Me Values 메일이 오지 않아요. 앱의 설정 → 이메일 소식 받기에서 다시 켤 수 있어요.', bad: '유효하지 않은 링크예요. 메일에 있는 링크를 사용해 주세요.' },
};

const pickLang = (lang) => {
  const base = String(lang || 'en').slice(0, 2).toLowerCase();
  return LANGS.includes(base) ? base : 'en';
};

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Display names are the player's own choice: trimmed, capped, and dropped
// when empty or when they look like a link or an email address.
const cleanName = (name) => {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!n || /https?:|www\.|@|\.(com|net|org|app|gg)\b/i.test(n)) return '';
  return n;
};

const fill = (tpl, name) => tpl.replace('{{name}}', name);

// ── Unsubscribe links ────────────────────────────────────────────────────
const unsubToken = (uid, secret) => crypto
  .createHmac('sha256', String(secret))
  .update(`unsub:${uid}`)
  .digest('base64url')
  .slice(0, 22);

const verifyUnsubToken = (uid, token, secret) => {
  if (!uid || !token || !secret) return false;
  const want = Buffer.from(unsubToken(uid, secret));
  const got = Buffer.from(String(token));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

const unsubUrl = (uid, lang, secret) =>
  `${UNSUB_BASE}?u=${encodeURIComponent(uid)}&t=${unsubToken(uid, secret)}&l=${pickLang(lang)}`;

// ── The email ────────────────────────────────────────────────────────────
// Gmail files designed mail (colour blocks, big buttons, emoji subjects) under
// Promotions. `plain` reads like a personal note instead: plain paragraphs, a
// text link, no emoji in the subject.
const stripEmoji = (s) => s.replace(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?/gu, '').trim();

/** { subject, html, text } for one player. */
function renderBirthdayEmail({ name, gift, lang, unsubscribeUrl, plain = false }) {
  const l = pickLang(lang);
  const c = COPY[l];
  const n = cleanName(name);
  const subject = n
    ? fill(gift ? c.subjectNamedGift : c.subjectNamed, n)
    : (gift ? c.subjectGift : c.subject);
  const title = n ? fill(c.titleNamed, n) : c.title;
  const body = gift ? c.gift : c.noGift;
  const button = gift ? c.buttonGift : c.button;
  const preheader = gift ? c.preheaderGift : c.preheader;
  const dir = l === 'ar' ? 'rtl' : 'ltr';
  const e = escapeHtml;

  if (plain) {
    const plainSubject = stripEmoji(subject);
    const html = `<!doctype html>
<html lang="${l}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(plainSubject)}</title></head>
<body style="margin:0;padding:16px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#222222;" dir="${dir}">
<div style="max-width:520px;">
<p style="margin:0 0 14px;">${e(stripEmoji(title))} 🎂</p>
<p style="margin:0 0 14px;">${e(body)}</p>
<p style="margin:0 0 14px;"><a href="${APP_URL}" style="color:#1A73E8;">${e(button)}</a></p>
<p style="margin:0 0 22px;">${e(c.signoff)}<br>${e(c.team)}</p>
<p style="margin:0;font-size:12px;line-height:18px;color:#777777;">${e(c.why)}<br><a href="${unsubscribeUrl}" style="color:#777777;">${e(c.unsubscribe)}</a> · ${e(POSTAL_ADDRESS)}<br>${e(c.disclaimer)}</p>
</div></body></html>`;
    const text = [stripEmoji(title), '', body, '', `${button}: ${APP_URL}`, '', c.signoff, c.team, '', '—',
      c.why, `${c.unsubscribe}: ${unsubscribeUrl}`, POSTAL_ADDRESS, c.disclaimer].join('\n');
    return { subject: plainSubject, html, text };
  }

  const html = `<!doctype html>
<html lang="${l}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FDF2F8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDF2F8;">
  <tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:24px;" dir="${dir}">
      <tr><td style="background:#EC4899;border-radius:24px 24px 0 0;height:10px;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td align="center" style="padding:30px 26px 6px;font-size:64px;line-height:72px;">🎂</td></tr>
      <tr><td align="center" style="padding:6px 26px 0;font-family:Helvetica,Arial,sans-serif;font-size:26px;line-height:32px;font-weight:800;color:#1F1A2E;">${e(title)}</td></tr>
      <tr><td align="center" style="padding:14px 28px 0;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#4B4560;">${e(body)}</td></tr>
      <tr><td align="center" style="padding:24px 26px 6px;">
        <a href="${APP_URL}" style="display:inline-block;background:#EC4899;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:800;text-decoration:none;padding:14px 28px;border-radius:999px;">${gift ? '🎁 ' : ''}${e(button)}</a>
      </td></tr>
      <tr><td align="center" style="padding:20px 26px 30px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#4B4560;">${e(c.signoff)}<br><strong style="color:#1F1A2E;">${e(c.team)}</strong></td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;" dir="${dir}">
      <tr><td align="center" style="padding:18px 20px 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8A7FA0;">
        ${e(c.why)}<br>
        <a href="${unsubscribeUrl}" style="color:#8A7FA0;text-decoration:underline;">${e(c.unsubscribe)}</a><br>
        ${e(POSTAL_ADDRESS)}<br>
        ${e(c.disclaimer)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    title, '', body, '', `${button}: ${APP_URL}`, '', c.signoff, c.team, '', '—',
    c.why, `${c.unsubscribe}: ${unsubscribeUrl}`, POSTAL_ADDRESS, c.disclaimer,
  ].join('\n');

  return { subject, html, text };
}

/** One email through Brevo's transactional API. Resolves Brevo's messageId. */
async function sendBrevo({ apiKey, to, toName, subject, html, text, unsubscribeUrl }) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: SENDER,
      to: [toName ? { email: to, name: toName } : { email: to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: ['birthday'],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`brevo ${res.status}: ${body.code || ''} ${body.message || ''}`.trim());
  return body.messageId;
}

module.exports = {
  SENDER, APP_URL, POSTAL_ADDRESS, LANGS, COPY, PAGE,
  pickLang, escapeHtml, cleanName,
  unsubToken, verifyUnsubToken, unsubUrl,
  renderBirthdayEmail, sendBrevo,
};
