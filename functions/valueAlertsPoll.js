/**
 * RECOVERED 2026-09-02 from the deployed Cloud Functions source archive:
 *   gs://gcf-sources-541413670501-us-central1/  (or gcf-v2-sources-… for v2)
 *
 * This function was running in production but had no source anywhere in this
 * repo — the historical deploy flow was one folder per function, with the
 * module renamed to index.js, so nothing here tracked it. Recovered verbatim
 * from the live archive so the repo is the complete source of truth again and
 * a full-codebase deploy can no longer silently delete it.
 *
 * Renamed from index.js to valueAlertsPoll.js to match this folder's convention.
 * Contents otherwise unmodified.
 */

/**
 * MM2 value-change push alerts — Firebase Cloud Function (schedule: every 15 min).
 *
 * Fetches the public values file from Bunny CDN, compares it with the last
 * snapshot (stored in this project's Realtime Database), then:
 *   1. logs every changed item under /value_alerts/changes
 *   2. sends one FCM push per changed item to topic `val_mm2_<slug>`
 *      — only users holding/wishing that item (My Stuff) are subscribed.
 *
 * Runs entirely inside the MM2 Firebase project. No other services.
 * First run is silent: it just saves the snapshot.
 */
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const VALUES_URL = "https://mm2-api.b-cdn.net/mm2values.json";
const GAME = "mm2";
const SNAPSHOT_REF = "value_alerts/snapshot"; // RTDB path holding last file text
const CHANGES_REF = "value_alerts/changes";   // RTDB log of changes (future feed)
const MAX_PUSHES = 400; // safety valve for a malformed upload

// MUST stay identical to slugItem() in Code/Helper/valueAlerts.js —
// the topic name is the app↔server contract.
const slug = (name) =>
  String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
};

// Walk any JSON shape and collect {name, value} items — handles the MM2
// nesting ({category:{tier:[{name,value,...}]}}) without hardcoding it.
function extractItems(node, out) {
  if (Array.isArray(node)) {
    for (const el of node) extractItems(el, out);
    return;
  }
  if (node && typeof node === "object") {
    const name =
      typeof node.name === "string" ? node.name : typeof node.Name === "string" ? node.Name : null;
    if (name) {
      const value = toNum(node.value) ?? toNum(node.Value) ?? toNum(node.rvalue);
      if (value !== null) {
        const s = slug(name);
        if (s && !out.has(s)) out.set(s, { name, value });
        return; // item leaf
      }
    }
    for (const v of Object.values(node)) extractItems(v, out);
  }
}

exports.valueAlertsPoll = onSchedule(
  { schedule: "every 15 minutes", timeZone: "Etc/UTC", memory: "256MiB", timeoutSeconds: 120 },
  async () => {
    // 1. Fetch the live file (cache-busted so we see the freshest version).
    const res = await fetch(`${VALUES_URL}?vcheck=${Date.now()}`, {
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) {
      logger.warn(`fetch failed: ${res.status}`);
      return;
    }
    const newText = await res.text();

    let newJson;
    try {
      newJson = JSON.parse(newText);
    } catch {
      logger.warn("values file is not valid JSON — skipped");
      return;
    }
    const newItems = new Map();
    extractItems(newJson, newItems);
    if (newItems.size === 0) {
      logger.warn("no items parsed — skipped");
      return;
    }

    // 2. Load previous snapshot from RTDB.
    const db = admin.database();
    const snapVal = (await db.ref(SNAPSHOT_REF).get()).val();

    const changes = [];
    let firstRun = true;
    if (snapVal && snapVal.text) {
      try {
        const oldItems = new Map();
        extractItems(JSON.parse(snapVal.text), oldItems);
        if (oldItems.size > 0) firstRun = false;
        for (const [s, item] of newItems) {
          const prev = oldItems.get(s);
          if (prev && prev.value !== item.value) {
            changes.push({ slug: s, name: item.name, oldV: prev.value, newV: item.value });
          }
        }
      } catch {
        // corrupt snapshot — treat as first run
      }
    }

    // 3. Save the new snapshot.
    await db.ref(SNAPSHOT_REF).set({ text: newText, updatedAt: Date.now() });

    if (firstRun) {
      logger.info(`first run: snapshot saved (${newItems.size} items), no alerts`);
      return;
    }
    if (changes.length === 0) {
      logger.info(`checked ${newItems.size} items — no changes`);
      return;
    }

    // 4. Log changes (future in-app "Value Changes" feed reads this).
    const logRef = db.ref(CHANGES_REF);
    await Promise.all(
      changes.map((c) =>
        logRef.push({
          game: GAME,
          item_slug: c.slug,
          item_name: c.name,
          old_value: c.oldV,
          new_value: c.newV,
          delta: c.newV - c.oldV,
          changed_at: Date.now(),
        }),
      ),
    );

    // 5. Push to each changed item's topic.
    let pushed = 0;
    const batch = changes.slice(0, MAX_PUSHES);
    const CHUNK = 10;
    for (let i = 0; i < batch.length; i += CHUNK) {
      await Promise.all(
        batch.slice(i, i + CHUNK).map(async (c) => {
          const up = c.newV > c.oldV;
          try {
            await admin.messaging().send({
              topic: `val_${GAME}_${c.slug}`,
              notification: {
                title: `${c.name} value ${up ? "increased! 📈" : "changed 📉"}`,
                body: `${c.oldV.toLocaleString()} → ${c.newV.toLocaleString()} (${up ? "+" : ""}${(c.newV - c.oldV).toLocaleString()})`,
              },
              data: { kind: "value_change", game: GAME, item: c.slug },
              android: { priority: "high" },
            });
            pushed++;
          } catch (e) {
            logger.warn(`push failed for ${c.slug}: ${e.message}`);
          }
        }),
      );
    }

    logger.info(`items: ${newItems.size}, changes: ${changes.length}, pushed: ${pushed}`);
  },
);
