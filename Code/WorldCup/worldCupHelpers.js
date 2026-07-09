// worldCupHelpers.js — pure, dependency-free helpers for the World Cup feature.
//
// Data contract (written by functions/fetchWorldCupData.js, read by the client):
//
//   wc2026_meta/feed         → { today:[Match], upcoming:[Match], recent:[Match], generatedAt }
//   wc2026_predictions/{id}  → { home:Number, draw:Number, away:Number }   (incremented by clients)
//   wc2026_user_picks/{uid}  → { picks:{ [matchId]: 'home'|'draw'|'away' }, updatedAt }
//
// Match = {
//   id, date, kickoffISO, group, round, ground, status,   // status: 'scheduled' | 'live' | 'finished'
//   team1, team2, code1, code2,                            // codeN = ISO-3166-1 alpha-2 or null (placeholder)
//   score1, score2,                                        // numbers when finished, else null
//   votes: { home, draw, away },                           // community tally, folded in by the CF
// }

// ISO-3166-1 alpha-2 → flag emoji (regional indicator symbols).
// Returns '' for null/unknown so the UI can fall back to the team text.
export const flagEmoji = (code) => {
  if (!code || code.length !== 2) return '';
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
};

// "Mexico" → "MEX" fallback label when we have no flag (e.g. "Winner Group A"
// placeholders before the bracket is decided).
export const shortLabel = (name = '') => {
  const clean = String(name).trim();
  if (!clean) return '???';
  if (clean.length <= 3) return clean.toUpperCase();
  return clean.slice(0, 3).toUpperCase();
};

// Local kickoff time, e.g. "Sat 7:00 PM". Falls back to the raw date on parse failure.
export const formatKickoff = (kickoffISO) => {
  if (!kickoffISO) return '';
  const d = new Date(kickoffISO);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d.toUTCString();
  }
};

// "Today", "Tomorrow", or "Jun 18" for grouping headers.
export const relativeDay = (kickoffISO) => {
  if (!kickoffISO) return '';
  const d = new Date(kickoffISO);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const dayMs = 86400000;
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(now)) / dayMs);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  try {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

// Percentages for the community-vote bar. Guards against divide-by-zero.
export const votePercents = (votes) => {
  const home = Number(votes?.home) || 0;
  const draw = Number(votes?.draw) || 0;
  const away = Number(votes?.away) || 0;
  const total = home + draw + away;
  if (total === 0) return { home: 0, draw: 0, away: 0, total: 0 };
  return {
    home: Math.round((home / total) * 100),
    draw: Math.round((draw / total) * 100),
    away: Math.round((away / total) * 100),
    total,
  };
};

// Did the user's pick match the final result? null when not finished / not picked.
export const pickOutcome = (match, pick) => {
  if (!pick || match?.status !== 'finished') return null;
  const s1 = Number(match.score1);
  const s2 = Number(match.score2);
  if (isNaN(s1) || isNaN(s2)) return null;
  const actual = s1 > s2 ? 'home' : s1 < s2 ? 'away' : 'draw';
  return actual === pick ? 'win' : 'loss';
};

// Points per correct prediction, and the bonus for nailing the tournament winner.
export const POINTS_PER_CORRECT = 10;
export const CHAMPION_BONUS = 50;

// Self-score, computed on-device for FREE from the user's picks and the
// `results` map (matchId → 'home'|'away'|'draw') carried in the feed doc.
// No server round-trip — points "appear" the moment a result lands in the feed.
// `userChampion`/`tournamentChampion` are team names; matching them adds the bonus.
// `boosts` (matchId → true) doubles the points for that correct pick (rewarded-ad reward).
export const computeScore = (picks, results, userChampion, tournamentChampion, boosts) => {
  let correct = 0;
  let total = 0;
  let points = 0;
  if (picks && results) {
    for (const matchId of Object.keys(picks)) {
      const actual = results[matchId];
      if (!actual) continue;          // match not finished yet
      total += 1;
      if (picks[matchId] === actual) {
        correct += 1;
        points += POINTS_PER_CORRECT * (boosts && boosts[matchId] ? 2 : 1);
      }
    }
  }
  const championHit = !!(userChampion && tournamentChampion && userChampion === tournamentChampion);
  if (championHit) points += CHAMPION_BONUS;
  return { points, correct, total, championHit };
};

// Champion-pick outcome for the UI: 'win' | 'loss' | null (Final not played yet).
export const championOutcome = (userChampion, tournamentChampion) => {
  if (!userChampion || !tournamentChampion) return null;
  return userChampion === tournamentChampion ? 'win' : 'loss';
};
