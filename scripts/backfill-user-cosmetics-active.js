// One-shot backfill: copy /users/{uid}/shop/activeItems into the 5 new
// jsonb columns on user_cosmetics added by supabase/016_user_cosmetics_active.sql.
//
// Why: mirrorUsersToSupabase only fans out activeItems on writes to
// /users/{uid}. Existing users whose shop hasn't been touched since the
// CF was deployed won't have profile_frame / chat_bubble_bg / etc. in
// Supabase yet — so OTHER users see them with default cosmetics in chat
// until a write fires. This script pre-populates them.
//
// Idempotent — upsert on uid only touches the 5 columns we provide; the
// existing top_badge / is_pro values from the original backfill are
// preserved.
//
// Run from project root (deps resolve from functions/node_modules):
//   SUPABASE_URL=https://kvtbtzhtcaanhjblyick.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/backfill-user-cosmetics-active.js

const path = require('path');

// No node_modules at repo root — point require at functions/node_modules.
const FUNCTIONS_NM = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(FUNCTIONS_NM, 'firebase-admin'));
const { createClient } = require(path.join(FUNCTIONS_NM, '@supabase', 'supabase-js'));

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}\n`);
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.\n');
  process.exit(1);
}

const RTDB_URL =
  process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const nowIso = () => new Date().toISOString();
const asJsonb = (v) => (v && typeof v === 'object' ? v : null);

// PAGE_USERS pulls the full /users/{uid} subtree per row, so keep it
// bounded — same reasoning as scripts/backfill-users-to-supabase.js.
const PAGE_USERS = parseInt(process.env.PAGE_USERS || '50', 10);
const FLUSH_AT = parseInt(process.env.FLUSH_AT || '200', 10);
const DRY_RUN = process.env.DRY_RUN === '1';

// Must match ACTIVE_ITEM_KEYS in functions/mirrorUsersToSupabase.js.
const ACTIVE_ITEM_KEYS = ['profileFrame', 'chatTextColor', 'tradeCardBg', 'profileBanner', 'chatBubbleBg'];

function cosmeticsRow(uid, activeItems) {
  return {
    uid,
    profile_frame:   asJsonb(activeItems.profileFrame),
    chat_text_color: asJsonb(activeItems.chatTextColor),
    trade_card_bg:   asJsonb(activeItems.tradeCardBg),
    profile_banner:  asJsonb(activeItems.profileBanner),
    chat_bubble_bg:  asJsonb(activeItems.chatBubbleBg),
    updated_at: nowIso(),
  };
}

async function upsertSlice(slice) {
  if (!slice.length || DRY_RUN) return;
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 60000];
  let attempt = 0;
  while (true) {
    const { error } = await supabase.from('user_cosmetics').upsert(slice, { onConflict: 'uid' });
    if (!error) return;
    attempt += 1;
    if (attempt > delays.length) {
      console.error(`\n❌ upsert failed after ${delays.length} retries:`, error.message);
      throw new Error(error.message);
    }
    const wait = delays[attempt - 1];
    process.stdout.write(`\n  ⚠️  retry ${attempt}/${delays.length} in ${wait}ms (${error.message})…\n`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

async function backfill() {
  console.log(`📥 Backfilling user_cosmetics active items (page=${PAGE_USERS}, flush=${FLUSH_AT}${DRY_RUN ? ', DRY_RUN' : ''})`);
  const ref = admin.database().ref('users');

  let lastKey = null;
  let usersSeen = 0;
  let usersWithItems = 0;
  let pageCount = 0;
  let buf = [];

  while (true) {
    let q = ref.orderByKey().limitToFirst(PAGE_USERS + (lastKey ? 1 : 0));
    if (lastKey) q = q.startAt(lastKey);

    const snap = await q.once('value');
    const page = snap.val();
    if (!page) break;

    const allKeys = Object.keys(page);
    const keys = lastKey ? allKeys.filter((k) => k !== lastKey) : allKeys;
    if (keys.length === 0) break;

    for (const uid of keys) {
      usersSeen += 1;
      const activeItems = page[uid]?.shop?.activeItems;
      if (!activeItems) continue;
      const hasAny = ACTIVE_ITEM_KEYS.some((k) => activeItems[k] != null);
      if (!hasAny) continue;
      buf.push(cosmeticsRow(uid, activeItems));
      usersWithItems += 1;
      if (buf.length >= FLUSH_AT) {
        const slice = buf; buf = [];
        await upsertSlice(slice);
      }
    }

    pageCount += 1;
    process.stdout.write(`page=${pageCount} users=${usersSeen} withItems=${usersWithItems}\n`);

    lastKey = allKeys[allKeys.length - 1];
    if (keys.length < PAGE_USERS) break;
  }

  if (buf.length) await upsertSlice(buf);

  console.log(`\n✅ Done. pages=${pageCount} usersSeen=${usersSeen} usersWithItems=${usersWithItems}${DRY_RUN ? ' (no writes — DRY_RUN)' : ''}`);
}

(async () => {
  const t0 = Date.now();
  try {
    await backfill();
    console.log(`⏱  Elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(0);
  } catch (e) {
    console.error('❌ Backfill failed:', e?.message || e);
    process.exit(1);
  }
})();
