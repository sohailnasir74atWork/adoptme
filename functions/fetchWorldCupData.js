/**
 * fetchWorldCupData — populates the World Cup 2026 prediction feed.
 *
 * WHAT IT DOES
 *   1. Fetches the tournament fixtures/results from a public source.
 *   2. Normalizes them into our Match schema (see Code/WorldCup/worldCupHelpers.js).
 *   3. Folds in the community vote tallies from wc2026_predictions/{id}.
 *   4. Writes ONE document: wc2026_meta/feed  → { today, upcoming, recent, generatedAt }.
 *      Clients read that single doc (1 read serves the whole screen).
 *
 * DATA SOURCE
 *   Default: openfootball/worldcup.json — public domain, NO API KEY required, so
 *   this works the moment it's deployed. Results can lag the live match by a few
 *   hours, which is fine: this is a prediction game, not a live-scores product.
 *
 *   Upgrade path: set the env var WC_SOURCE_URL to any endpoint that returns the
 *   same { matches: [...] } shape, or implement an API-Football adapter inside
 *   buildMatches() guarded on process.env.APIFOOTBALL_KEY for true live scores.
 *
 * EXPORTS (wire both into your functions index.js / deploy entry):
 *   • fetchWorldCupDataScheduled — pubsub, every 30 min. The production updater.
 *   • fetchWorldCupDataNow       — HTTPS, call once after deploy to seed the doc
 *                                  immediately instead of waiting for the schedule.
 *
 * SCHEDULE NOTE
 *   30 min is deliberately coarse. We don't sell goal-by-goal scores, so there's
 *   no need to poll the source hard. It keeps us comfortably inside any free API
 *   tier and keeps Firestore writes minimal (one feed-doc write per run).
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const axios = require("axios");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

// How many fixtures to surface for voting / recap.
const UPCOMING_LIMIT = 14;
const RECENT_LIMIT = 8;
const RECENT_WINDOW_MS = 2 * 24 * 60 * 60 * 1000; // finished matches from the last 2 days

// ── Country name → ISO-3166-1 alpha-2 (drives flag emojis on the client). ──
// Placeholders like "Winner Group A" / "1A" simply won't match and render as text.
const NAME_TO_ISO2 = {
  Argentina: "AR", Australia: "AU", Austria: "AT", Belgium: "BE", Brazil: "BR",
  Cameroon: "CM", Canada: "CA", Colombia: "CO", "Costa Rica": "CR", Croatia: "HR",
  Denmark: "DK", Ecuador: "EC", Egypt: "EG", England: "GB", France: "FR",
  Germany: "DE", Ghana: "GH", Greece: "GR", "Ivory Coast": "CI", Iran: "IR",
  Italy: "IT", Japan: "JP", Mexico: "MX", Morocco: "MA", Netherlands: "NL",
  "New Zealand": "NZ", Nigeria: "NG", Norway: "NO", Panama: "PA", Paraguay: "PY",
  Peru: "PE", Poland: "PL", Portugal: "PT", Qatar: "QA", "Saudi Arabia": "SA",
  Scotland: "GB", Senegal: "SN", Serbia: "RS", "South Africa": "ZA",
  "South Korea": "KR", "Korea Republic": "KR", Spain: "ES", Sweden: "SE",
  Switzerland: "CH", Tunisia: "TN", Turkey: "TR", Ukraine: "UA",
  "United States": "US", USA: "US", Uruguay: "UY", Wales: "GB", Algeria: "DZ",
  Jordan: "JO", Uzbekistan: "UZ", "Cape Verde": "CV", Honduras: "HN",
  Jamaica: "JM", "Curacao": "CW", Haiti: "HT", Bolivia: "BO", "DR Congo": "CD",
};

const iso2 = (name) => NAME_TO_ISO2[String(name || "").trim()] || null;

// Parse openfootball date+time into a UTC ISO instant.
// time looks like "13:00 UTC-6" (offset is the venue's local offset from UTC).
function toKickoffISO(date, time) {
  if (!date) return null;
  const m = String(time || "").match(/(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})?/);
  if (!m) {
    // No usable time — anchor at local noon of the date so day-grouping still works.
    return new Date(`${date}T12:00:00Z`).toISOString();
  }
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const offset = m[3] ? parseInt(m[3], 10) : 0;
  // Local time at venue = hh:mm; UTC = local - offset.
  const utcHour = hh - offset;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCHours(utcHour, mm, 0, 0);
  return d.toISOString();
}

function statusFor(kickoffISO, hasScore, nowMs) {
  if (hasScore) return "finished";
  if (!kickoffISO) return "scheduled";
  const k = new Date(kickoffISO).getTime();
  if (nowMs >= k && nowMs < k + 2.5 * 60 * 60 * 1000) return "live"; // best-effort window
  return "scheduled";
}

function slugId(date, t1, t2) {
  const s = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${date}_${s(t1)}_vs_${s(t2)}`;
}

// Normalize the raw source into our Match[] (source-specific parsing lives here).
function buildMatches(raw, nowMs) {
  const rawMatches = Array.isArray(raw?.matches) ? raw.matches : [];
  return rawMatches
    .filter((m) => m && m.team1 && m.team2 && m.date)
    .map((m) => {
      const ft = m.score && Array.isArray(m.score.ft) ? m.score.ft : null;
      const hasScore = ft && ft.length === 2 && ft[0] != null && ft[1] != null;
      const kickoffISO = toKickoffISO(m.date, m.time);
      return {
        id: slugId(m.date, m.team1, m.team2),
        date: m.date,
        kickoffISO,
        group: m.group || null,
        round: m.round || null,
        ground: m.ground || null,
        team1: m.team1,
        team2: m.team2,
        code1: iso2(m.team1),
        code2: iso2(m.team2),
        score1: hasScore ? Number(ft[0]) : null,
        score2: hasScore ? Number(ft[1]) : null,
        status: statusFor(kickoffISO, hasScore, nowMs),
        votes: { home: 0, draw: 0, away: 0 },
      };
    });
}

// Fold community tallies into the matches that will be shown (bounded reads).
async function attachVotes(matches) {
  await Promise.all(
    matches.map(async (m) => {
      try {
        const snap = await db.collection("wc2026_predictions").doc(m.id).get();
        if (snap.exists) {
          const v = snap.data() || {};
          m.votes = {
            home: Number(v.home) || 0,
            draw: Number(v.draw) || 0,
            away: Number(v.away) || 0,
          };
        }
      } catch (e) {
        // Non-fatal: a missing tally just shows 0%.
        console.warn(`vote fold failed for ${m.id}: ${e.message}`);
      }
    }),
  );
}

// Core routine shared by the scheduled + on-demand exports.
async function runSync() {
  const url = process.env.WC_SOURCE_URL || DEFAULT_SOURCE;
  const nowMs = Date.now();

  const res = await axios.get(url, { timeout: 15000 });
  const all = buildMatches(res.data, nowMs);
  if (all.length === 0) {
    console.warn("⚠️ No matches parsed from source — leaving feed untouched.");
    return { wrote: false, count: 0 };
  }

  const byKickoff = (a, b) =>
    new Date(a.kickoffISO || a.date).getTime() - new Date(b.kickoffISO || b.date).getTime();

  const todayStr = new Date(nowMs).toISOString().slice(0, 10);
  const today = all.filter((m) => m.date === todayStr).sort(byKickoff);

  const upcoming = all
    .filter((m) => m.status === "scheduled" && new Date(m.kickoffISO || m.date).getTime() >= nowMs)
    .sort(byKickoff)
    .slice(0, UPCOMING_LIMIT);

  const recent = all
    .filter(
      (m) =>
        m.status === "finished" &&
        nowMs - new Date(m.kickoffISO || m.date).getTime() <= RECENT_WINDOW_MS,
    )
    .sort((a, b) => byKickoff(b, a))
    .slice(0, RECENT_LIMIT);

  // Only the surfaced matches need vote tallies. Dedupe by id first — a match
  // that is both "today" AND "upcoming" must not be read (or bumped) twice.
  const voteTargets = [...today, ...upcoming];
  const seen = new Set();
  const uniqueTargets = voteTargets.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  await attachVotes(uniqueTargets);

  // Compact results map (matchId → winner) for ALL finished matches. Lets the
  // client compute each user's score for FREE from one feed read — no per-match
  // reads, no scoring fan-out. ~104 tiny entries over a full tournament.
  const results = {};
  for (const m of all) {
    if (m.status === "finished" && m.score1 != null && m.score2 != null) {
      results[m.id] = m.score1 > m.score2 ? "home" : m.score1 < m.score2 ? "away" : "draw";
    }
  }

  // Unique real teams (those we have a flag code for — skips "1A"/"Winner Group A"
  // placeholders). Powers the "Predict the Champion" picker. Sorted by name.
  const teamMap = {};
  for (const m of all) {
    if (m.code1 && !teamMap[m.team1]) teamMap[m.team1] = { name: m.team1, code: m.code1 };
    if (m.code2 && !teamMap[m.team2]) teamMap[m.team2] = { name: m.team2, code: m.code2 };
  }
  const teams = Object.values(teamMap).sort((a, b) => a.name.localeCompare(b.name));

  // ── Group standings (P / W / D / L / GF / GA / GD / Pts) ──
  // Computed from every group-stage match. Win = 3 pts, draw = 1. Sorted by
  // Pts → GD → GF → name. Added to the feed so the client renders it from 1 read.
  const groups = {};
  for (const m of all) {
    if (!m.group) continue; // knockout matches have a round, not a group
    groups[m.group] = groups[m.group] || {};
    const g = groups[m.group];
    for (const [name, code] of [[m.team1, m.code1], [m.team2, m.code2]]) {
      if (!g[name]) g[name] = { name, code: code || null, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 };
    }
    if (m.status === "finished" && m.score1 != null && m.score2 != null) {
      const a = g[m.team1];
      const b = g[m.team2];
      a.P++; b.P++;
      a.GF += m.score1; a.GA += m.score2;
      b.GF += m.score2; b.GA += m.score1;
      if (m.score1 > m.score2) { a.W++; a.Pts += 3; b.L++; }
      else if (m.score1 < m.score2) { b.W++; b.Pts += 3; a.L++; }
      else { a.D++; b.D++; a.Pts++; b.Pts++; }
    }
  }
  const standings = {};
  for (const name of Object.keys(groups).sort()) {
    standings[name] = Object.values(groups[name])
      .map((t) => ({ ...t, GD: t.GF - t.GA }))
      .sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || x.name.localeCompare(y.name));
  }

  // Actual tournament winner (the Final's winner), once it's played. Drives the
  // champion-pick bonus, scored on-device. null until the Final finishes.
  let tournamentChampion = null;
  const finalMatch = all.find(
    (m) =>
      m.round &&
      /final/i.test(m.round) &&
      !/(semi|quarter)/i.test(m.round) &&
      m.status === "finished" &&
      m.score1 != null &&
      m.score2 != null,
  );
  if (finalMatch && finalMatch.score1 !== finalMatch.score2) {
    tournamentChampion = finalMatch.score1 > finalMatch.score2 ? finalMatch.team1 : finalMatch.team2;
  }

  await db.collection("wc2026_meta").doc("feed").set({
    today,
    upcoming,
    recent,
    results,
    teams,
    standings,
    tournamentChampion,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: url,
  });

  console.log(
    `✅ WC feed updated — today:${today.length} upcoming:${upcoming.length} recent:${recent.length}`,
  );
  return { wrote: true, today: today.length, upcoming: upcoming.length, recent: recent.length };
}

// Exposed for one-off local seeding (functions/seedWorldCup.local.js). Not a
// deployable trigger — harmless extra export, ignored by `firebase deploy`.
exports.runSync = runSync;

// Production updater: every 30 minutes.
exports.fetchWorldCupDataScheduled = functions.pubsub
  .schedule("every 30 minutes")
  .onRun(async () => {
    try {
      await runSync();
    } catch (err) {
      console.error("❌ fetchWorldCupDataScheduled error:", err.message);
    }
    return null;
  });

// On-demand seed/refresh: GET this URL once after deploy to populate the feed now.
exports.fetchWorldCupDataNow = functions.https.onRequest(async (req, res) => {
  try {
    const result = await runSync();
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error("❌ fetchWorldCupDataNow error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Leaderboard ──
// Clients self-report their score to wc2026_scores/{uid} (1 write per session
// when it changes). This builds the top-100 cache that every client reads as a
// SINGLE doc (wc2026_meta/leaderboard).
//
// COST: the orderBy+limit(100) query bills only the 100 docs RETURNED, not the
// whole collection — so this stays cheap no matter how many players there are.
// (Requires the auto-created single-field index on `points`.)
async function buildLeaderboard() {
  const snap = await db
    .collection("wc2026_scores")
    .orderBy("points", "desc")
    .limit(100)
    .get();

  const top = snap.docs.map((d, i) => {
    const x = d.data() || {};
    return {
      rank: i + 1,
      uid: d.id,
      name: x.displayName || "Player",
      avatar: x.avatar || null,
      points: Number(x.points) || 0,
      correct: Number(x.correct) || 0,
      total: Number(x.total) || 0,
    };
  });

  await db.collection("wc2026_meta").doc("leaderboard").set({
    top,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✅ WC leaderboard updated — ${top.length} players`);
  return top.length;
}

exports.buildWorldCupLeaderboard = buildLeaderboard; // local seeding helper

exports.updateWorldCupLeaderboard = functions.pubsub
  .schedule("every 60 minutes")
  .onRun(async () => {
    try {
      await buildLeaderboard();
    } catch (err) {
      console.error("❌ updateWorldCupLeaderboard error:", err.message);
    }
    return null;
  });
