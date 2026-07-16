/**
 * functions/grantAllCosmetics.js  —  LOCAL ADMIN UTILITY (do NOT deploy)
 *
 * Grants EVERY cosmetic (profile frames, chat text colors, trade-card
 * backgrounds, profile banners, chat backgrounds) to a single user,
 * permanently, so they can equip any of them from the My Cosmetics screen.
 *
 * SAFE · ADDITIVE · IDEMPOTENT
 *   • Writes ONLY under  users/<uid>/shop/ownedItems/<type>/<itemId>
 *   • Keyed by item id, so re-running overwrites the same nodes (no dupes)
 *   • Grants OWNERSHIP only — nothing is force-equipped, no star balance or
 *     other fields touched, no other users affected. The user picks and
 *     applies items themselves in the app.
 *
 * Run from the repo root, in YOUR trusted environment (uses serviceAccount.json):
 *   node functions/grantAllCosmetics.js DNvBQC5ySWP8QiJNGpIvqd9DSWB2
 *
 * Optional 2nd arg (or RTDB_URL env var) if your database is in a non-default
 * region — defaults to https://<project_id>-default-rtdb.firebaseio.com
 *
 * To grant frames only, set  ONLY_TYPE=profileFrame  in the env.
 */

const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

const ROOT = path.join(__dirname, '..');
const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node functions/grantAllCosmetics.js <uid> [rtdbUrl]');
  process.exit(1);
}

// ── Load the cosmetic catalog straight from the app source ──────────────
// shopItems.js is authored as an ES module (.js) with only top-level
// `export const` (pure data, no imports). Compile it to CommonJS so this
// stays in lockstep with the app — new frames added there are granted
// automatically. Try babel; fall back to a dependency-free strip.
function loadCatalog() {
  const file = path.join(ROOT, 'Code/Engagement/shopItems.js');
  let code;
  try {
    const babel = require('@babel/core');
    code = babel.transformFileSync(file, {
      babelrc: false,
      configFile: false,
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    }).code;
  } catch (e) {
    // Fallback: file is pure-data ESM, so rewrite `export const X` -> `const X`
    // and re-export the captured names via module.exports.
    let src = fs.readFileSync(file, 'utf8');
    const names = [...src.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)/g)].map((m) => m[1]);
    src = src.replace(/export\s+const/g, 'const') + `\nmodule.exports = { ${names.join(', ')} };`;
    code = src;
  }
  const Module = require('module');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(code, file);
  return m.exports;
}

const { ALL_ITEMS } = loadCatalog();

const serviceAccount = require(path.join(ROOT, 'serviceAccount.json'));
const databaseURL =
  process.argv[3] ||
  process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL });
const db = admin.database();

const ONLY_TYPE = process.env.ONLY_TYPE || null; // e.g. 'profileFrame' for frames only

(async () => {
  // Confirm the user exists so a mistyped UID can't create an orphan node.
  const nameSnap = await db.ref(`users/${uid}/displayName`).get();
  if (!nameSnap.exists()) {
    console.error(`No user at users/${uid} (displayName missing). Aborting — double-check the UID.`);
    process.exit(1);
  }
  console.log(`Granting cosmetics to "${nameSnap.val()}" (${uid})${ONLY_TYPE ? ` — type=${ONLY_TYPE}` : ''}`);

  const now = Date.now();
  const updates = {};
  const perType = {};
  for (const item of Object.values(ALL_ITEMS)) {
    if (!item || !item.id || !item.type) continue;
    if (ONLY_TYPE && item.type !== ONLY_TYPE) continue;
    updates[`${item.type}/${item.id}`] = {
      ...item,          // borderColors/glowColor/color/darkColor/gradient -> correct previews
      type: item.type,
      activatedAt: now,
      expiresAt: -1,    // permanent — never expires
    };
    perType[item.type] = (perType[item.type] || 0) + 1;
  }

  const total = Object.keys(updates).length;
  if (total === 0) {
    console.error('Nothing to grant (empty catalog / ONLY_TYPE matched nothing).');
    process.exit(1);
  }
  console.log(`Granting ${total} items:`, perType);

  // Single additive write — only touches these ownedItems child paths.
  await db.ref(`users/${uid}/shop/ownedItems`).update(updates);

  console.log('Done. She can open My Cosmetics and equip any of them.');
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e);
  process.exit(1);
});
