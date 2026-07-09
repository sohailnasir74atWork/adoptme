// LOCAL-ONLY: flip the World Cup kill switch in RTDB (what you'd do from the backend).
//   node functions/setWorldCupFlag.local.js false   → hide the whole feature
//   node functions/setWorldCupFlag.local.js true    → show it
//   node functions/setWorldCupFlag.local.js delete  → remove the node (defaults to ON)

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccount.json');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
  });
}

const arg = (process.argv[2] || '').toLowerCase();
const ref = admin.database().ref('worldcup_enabled');
const op =
  arg === 'delete' ? ref.remove() :
  arg === 'true' ? ref.set(true) :
  arg === 'false' ? ref.set(false) :
  Promise.reject(new Error('pass true | false | delete'));

op.then(() => { console.log(`✅ worldcup_enabled → ${arg}`); process.exit(0); })
  .catch((e) => { console.error('❌', e.message); process.exit(1); });
