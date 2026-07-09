// WorldCupScreen.jsx — FIFA World Cup 2026 prediction game.
//
// Framing: this is NOT a live-scores product (our users have FotMob/TikTok for
// that). It's a 30-second daily prediction game bolted onto an app they already
// open — pick a winner, see what the crowd thinks, come back to find out if you
// called it. Football is just the theme; the loop is the product.
//
// UI goal: big, chunky, colorful, kid-friendly. Tap a team's flag to vote. No
// dense tables, no jargon — just "Who wins? 👇".
//
// Cost design (see worldCupHelpers.js for the schema):
//   • One onSnapshot on wc2026_meta/feed  → ~1 read per refresh for ALL data.
//   • One getDoc on wc2026_user_picks/{uid} on mount to restore the user's picks.
//   • Votes write to per-match wc2026_predictions/{id} (distributes write load).
//   • Community % is folded into the feed doc by the CF; voter sees their pick optimistically.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Linking, Platform, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Rect } from 'react-native-svg';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp, increment,
} from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import BannerAdComponent from '../Ads/bannerAds';
import NativeAdCard from '../Ads/NativeAdCard';
import RewardedAdManager from '../Ads/RewardedAdManager';
import {
  flagEmoji, shortLabel, formatKickoff, votePercents, pickOutcome, computeScore, championOutcome,
} from './worldCupHelpers';

// Rights-safe highlights: deep-link to a YouTube search rather than embedding.
const openHighlights = (m) => {
  const q = encodeURIComponent(`FIFA World Cup 2026 ${m.team1} vs ${m.team2} highlights`);
  Linking.openURL(`https://www.youtube.com/results?search_query=${q}`).catch(() => {});
};

// Fun, fixed accent palette (kept independent of the app theme so the feature
// always feels bright and playful in both light and dark mode).
const PITCH = '#16A34A';   // football-pitch green
const PITCH_DK = '#15803D';
const GOLD = '#F59E0B';    // trophy gold
const DRAW = '#F59E0B';    // draw / amber
const PICK = '#16A34A';    // your-pick highlight

// Card widths for the horizontal carousels — each leaves a peek of the next card.
const SCREEN_W = Dimensions.get('window').width;
const CARD_W = Math.min(330, Math.round(SCREEN_W * 0.84));
const RESULT_W = Math.min(250, Math.round(SCREEN_W * 0.64));

// Brand gradient (purple → indigo → blue) used behind the hero & share card.
// Rendered with react-native-svg (no linear-gradient native dep needed).
const BrandGradient = ({ id = 'wcHeroGrad' }) => (
  <Svg style={StyleSheet.absoluteFill}>
    <Defs>
      <SvgGradient id={id} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#7C3AED" />
        <Stop offset="0.55" stopColor="#5B21B6" />
        <Stop offset="1" stopColor="#2563EB" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
  </Svg>
);

const WorldCupScreen = ({ selectedTheme }) => {
  const { user, firestoreDB, theme } = useGlobalState();
  const { localState } = useLocalState();
  const isPro = !!localState?.isPro;
  const isDark = theme === 'dark';
  const c = useThemeColors();
  const insets = useSafeAreaInsets();

  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [picks, setPicks] = useState({}); // { [matchId]: 'home'|'draw'|'away' }
  const [boosts, setBoosts] = useState({}); // { [matchId]: true } — 2× rewarded boosts
  const [leaderboard, setLeaderboard] = useState(null);
  const [champion, setChampion] = useState(null); // user's predicted tournament winner (team name)
  const votingRef = useRef(new Set());
  const boostingRef = useRef(new Set());
  const lastScoreRef = useRef(-1); // last points value written to wc2026_scores
  const shareRef = useRef(null);   // ViewShot for the share card

  // ── Live feed subscription (single doc) ──
  useEffect(() => {
    if (!firestoreDB) return;
    const ref = doc(firestoreDB, 'wc2026_meta', 'feed');
    const unsub = onSnapshot(
      ref,
      (snap) => { setFeed(snap.exists() ? snap.data() : null); setLoading(false); },
      (err) => { console.warn('[WorldCup] feed error:', err?.message); setLoading(false); },
    );
    return unsub;
  }, [firestoreDB]);

  // ── Restore this user's picks once ──
  useEffect(() => {
    if (!firestoreDB || !user?.id) return;
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'wc2026_user_picks', user.id));
        if (alive && snap.exists()) {
          setPicks(snap.data()?.picks || {});
          setChampion(snap.data()?.champion || null); // champion lives in the same doc (no extra read)
          setBoosts(snap.data()?.boosts || {});       // 2× boosts too — same doc
        }
      } catch (err) {
        console.warn('[WorldCup] picks restore error:', err?.message);
      }
    })();
    return () => { alive = false; };
  }, [firestoreDB, user?.id]);

  // ── Leaderboard: read the single cached doc once (CF rebuilds it hourly) ──
  useEffect(() => {
    if (!firestoreDB) return;
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'wc2026_meta', 'leaderboard'));
        if (alive && snap.exists()) setLeaderboard(snap.data()?.top || []);
      } catch (err) {
        console.warn('[WorldCup] leaderboard error:', err?.message);
      }
    })();
    return () => { alive = false; };
  }, [firestoreDB]);

  // ── Self-score: computed on-device for free from picks × feed results (+ champion bonus + 2× boosts) ──
  const score = useMemo(
    () => computeScore(picks, feed?.results, champion, feed?.tournamentChampion, boosts),
    [picks, feed?.results, champion, feed?.tournamentChampion, boosts],
  );

  // ── Self-report score to wc2026_scores/{uid} (drives the leaderboard). One
  //    write only when the score actually changes — never on every render ──
  useEffect(() => {
    if (!firestoreDB || !user?.id) return;
    if (score.total === 0) return;                 // nothing scored yet
    if (score.points === lastScoreRef.current) return; // unchanged → skip write
    lastScoreRef.current = score.points;
    setDoc(
      doc(firestoreDB, 'wc2026_scores', user.id),
      {
        points: score.points,
        correct: score.correct,
        total: score.total,
        displayName: user.displayName || 'Player',
        avatar: user.avatar || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    ).catch((err) => console.warn('[WorldCup] score write error:', err?.message));
  }, [firestoreDB, user?.id, user?.displayName, user?.avatar, score]);

  const handleVote = useCallback(async (match, choice) => {
    const matchId = match?.id;
    if (!matchId) return;
    if (!user?.id) {
      Alert.alert('Sign in to play! ⚽', 'Log in to lock your pick and start earning points.');
      return;
    }
    if (picks[matchId]) return;
    if (votingRef.current.has(matchId)) return;
    votingRef.current.add(matchId);

    setPicks((prev) => ({ ...prev, [matchId]: choice }));
    setFeed((prev) => bumpLocalVote(prev, matchId, choice));

    try {
      await Promise.all([
        setDoc(
          doc(firestoreDB, 'wc2026_user_picks', user.id),
          { picks: { [matchId]: choice }, updatedAt: serverTimestamp() },
          { merge: true },
        ),
        setDoc(
          doc(firestoreDB, 'wc2026_predictions', matchId),
          { [choice]: increment(1) },
          { merge: true },
        ),
      ]);
    } catch (err) {
      console.warn('[WorldCup] vote error:', err?.message);
      setPicks((prev) => { const n = { ...prev }; delete n[matchId]; return n; });
    } finally {
      votingRef.current.delete(matchId);
    }
  }, [firestoreDB, user?.id, picks]);

  const pickChampion = useCallback((team) => {
    if (!user?.id) {
      Alert.alert('Sign in to play! ⚽', 'Log in to pick your champion and earn points.');
      return;
    }
    setChampion(team.name); // optimistic
    setDoc(
      doc(firestoreDB, 'wc2026_user_picks', user.id),
      { champion: team.name, updatedAt: serverTimestamp() },
      { merge: true },
    ).catch((err) => console.warn('[WorldCup] champion write error:', err?.message));
  }, [firestoreDB, user?.id]);

  // Rewarded "2× points" boost. Pro users get it free (they don't watch ads);
  // everyone else watches a rewarded ad and earns it on completion.
  const boostMatch = useCallback(async (matchId) => {
    if (!matchId || boosts[matchId]) return;
    if (!user?.id) {
      Alert.alert('Sign in to play! ⚽', 'Log in to boost your picks and earn double points.');
      return;
    }
    if (boostingRef.current.has(matchId)) return;
    boostingRef.current.add(matchId);
    try {
      let earned = true;
      if (!isPro) {
        earned = await RewardedAdManager.show(); // resolves true only if the full ad was watched
      }
      if (!earned) return;
      setBoosts((prev) => ({ ...prev, [matchId]: true }));
      await setDoc(
        doc(firestoreDB, 'wc2026_user_picks', user.id),
        { boosts: { [matchId]: true }, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (err) {
      console.warn('[WorldCup] boost error:', err?.message);
    } finally {
      boostingRef.current.delete(matchId);
    }
  }, [firestoreDB, user?.id, isPro, boosts]);

  const handleShare = useCallback(async () => {
    try {
      if (!shareRef.current) return;
      const uri = await shareRef.current.capture();
      await Share.open({ url: uri, type: 'image/png', failOnCancel: false });
    } catch (err) {
      if (err?.message && !/cancel/i.test(err.message)) {
        console.warn('[WorldCup] share error:', err?.message);
      }
    }
  }, []);

  const today = feed?.today || [];
  const upcoming = feed?.upcoming || [];
  const recent = feed?.recent || [];
  const teams = feed?.teams || [];
  const standings = feed?.standings || {};
  const groupNames = Object.keys(standings);
  const votedCount = Object.keys(picks).length;
  const championTeam = champion ? teams.find((t) => t.name === champion) || { name: champion, code: null } : null;

  const styles = useMemo(() => makeStyles(c, isDark), [c, isDark]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={PITCH} />
      </View>
    );
  }

  const isEmpty = today.length === 0 && upcoming.length === 0 && recent.length === 0;

  // NOTE: mounted inside CustomTopTabs (which already applies the top safe-area
  // inset and sits us below the tab pills), so we don't re-add insets.top.
  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Fun hero banner */}
        <View style={styles.hero}>
          <BrandGradient id="wcHeroGrad" />
          <Text style={styles.heroTrophy}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>World Cup 2026</Text>
            <Text style={styles.heroSub}>Tap who you think will win! ⚽</Text>
          </View>
          {score.total > 0 ? (
            <View style={styles.heroCountPill}>
              <Text style={styles.heroCountNum}>{score.points}</Text>
              <Text style={styles.heroCountLbl}>points</Text>
            </View>
          ) : votedCount > 0 ? (
            <View style={styles.heroCountPill}>
              <Text style={styles.heroCountNum}>{votedCount}</Text>
              <Text style={styles.heroCountLbl}>picks</Text>
            </View>
          ) : null}
        </View>

        <BannerAdComponent adType="banner" />

        {isEmpty && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>⚽</Text>
            <Text style={[styles.emptyTitle, { color: c.text }]}>Game on soon!</Text>
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              Matches are loading. Check back in a bit. 👀
            </Text>
          </View>
        )}

        {/* Today strip */}
        {today.length > 0 && (
          <Section emoji="📅" title="Today's Games">
            <FlatList
              horizontal
              data={today}
              keyExtractor={(m) => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 2 }}
              renderItem={({ item }) => <TodayChip match={item} styles={styles} c={c} />}
            />
          </Section>
        )}

        {/* Group standings — swipeable group cards */}
        {groupNames.length > 0 && (
          <Section emoji="📊" title="Group Standings" subtitle="Swipe through the groups 👉">
            <FlatList
              horizontal
              data={groupNames}
              keyExtractor={(g) => g}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12 }}
              snapToInterval={CARD_W + 12}
              decelerationRate="fast"
              renderItem={({ item }) => (
                <GroupCard name={item} rows={standings[item]} styles={styles} c={c} />
              )}
            />
          </Section>
        )}

        {/* Champion pick (Phase 3) */}
        {teams.length > 0 && (
          <Section emoji="👑" title="Predict the Champion" subtitle="Who lifts the trophy? 🏆">
            <ChampionPicker
              teams={teams}
              champion={champion}
              championTeam={championTeam}
              outcome={championOutcome(champion, feed?.tournamentChampion)}
              onPick={pickChampion}
              styles={styles}
              c={c}
            />
          </Section>
        )}

        {/* Prediction cards — horizontal carousel */}
        {upcoming.length > 0 && (
          <Section emoji="🔮" title="Make Your Picks" subtitle="Swipe → who wins? 👉">
            <FlatList
              horizontal
              data={upcoming}
              keyExtractor={(m) => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12 }}
              snapToInterval={CARD_W + 12}
              decelerationRate="fast"
              renderItem={({ item }) => (
                <PredictionCard
                  match={item}
                  pick={picks[item.id]}
                  boosted={!!boosts[item.id]}
                  isPro={isPro}
                  onVote={handleVote}
                  onBoost={boostMatch}
                  styles={styles}
                  c={c}
                />
              )}
            />
          </Section>
        )}

        {/* Native ad — full-width (collapses to nothing if unfilled); Pro users skip */}
        {!isPro && <NativeAdCard adKey="wc_picks" isDarkMode={isDark} />}

        {/* Recent results — horizontal carousel */}
        {recent.length > 0 && (
          <Section emoji="🏁" title="Results">
            <FlatList
              horizontal
              data={recent}
              keyExtractor={(m) => m.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12 }}
              renderItem={({ item }) => (
                <ResultCard match={item} pick={picks[item.id]} styles={styles} c={c} />
              )}
            />
          </Section>
        )}

        {/* Native ad — second slot before the leaderboard; Pro users skip */}
        {!isPro && <NativeAdCard adKey="wc_results" isDarkMode={isDark} />}

        {/* Leaderboard — always shown (with an empty state) so players know it exists */}
        {!isEmpty && (
          <Section emoji="🏆" title="Leaderboard" subtitle="Top predictors 🔥">
            {(!leaderboard || leaderboard.length === 0) ? (
              <View style={styles.lbEmpty}>
                <Text style={styles.lbEmptyIcon}>🏅</Text>
                <Text style={[styles.lbEmptyText, { color: c.textSecondary }]}>
                  No scores yet — make your picks and check back after the matches finish!
                </Text>
              </View>
            ) : (
            <View style={styles.lbCard}>
              {leaderboard.slice(0, 10).map((row) => {
                const isMe = row.uid === user?.id;
                return (
                  <View key={row.uid} style={[styles.lbRow, isMe && styles.lbRowMe]}>
                    <Text style={[styles.lbRank, row.rank <= 3 && styles.lbRankTop]}>
                      {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : row.rank}
                    </Text>
                    <Text style={[styles.lbName, { color: c.text }]} numberOfLines={1}>
                      {row.name}{isMe ? '  (you)' : ''}
                    </Text>
                    <Text style={styles.lbPts}>{row.points} pts</Text>
                  </View>
                );
              })}
            </View>
            )}
          </Section>
        )}

        {/* Share card (Phase 3) */}
        {(championTeam || score.total > 0 || votedCount > 0) && (
          <Section emoji="📣" title="Show Off Your Picks" subtitle="Challenge your friends!">
            <ViewShot ref={shareRef} options={{ format: 'png', quality: 0.9 }} style={styles.shareCard}>
              <Text style={styles.shareTitle}>🏆 World Cup 2026</Text>
              <Text style={styles.shareApp}>{config.appName}</Text>
              {championTeam && (
                <View style={styles.shareChampRow}>
                  <Text style={styles.shareChampLabel}>My champion</Text>
                  <Text style={styles.shareChampTeam}>
                    {flagEmoji(championTeam.code) || '🏳️'} {championTeam.name}
                  </Text>
                </View>
              )}
              <View style={styles.shareStatsRow}>
                <ShareStat value={score.points} label="points" />
                <ShareStat value={votedCount} label="picks" />
                <ShareStat value={score.total > 0 ? `${score.correct}/${score.total}` : '—'} label="correct" />
              </View>
              <Text style={styles.shareTag}>Can you beat me? ⚽</Text>
            </ViewShot>
            <TouchableOpacity style={styles.shareBtn} activeOpacity={0.85} onPress={handleShare}>
              <Text style={styles.shareBtnText}>📲  Share my picks</Text>
            </TouchableOpacity>
          </Section>
        )}
      </ScrollView>
    </View>
  );
};

// ── Optimistic local tally bump ──
function bumpLocalVote(feed, matchId, choice) {
  if (!feed) return feed;
  const patch = (arr) =>
    (arr || []).map((m) => {
      if (m.id !== matchId) return m;
      const votes = { home: 0, draw: 0, away: 0, ...(m.votes || {}) };
      votes[choice] = (Number(votes[choice]) || 0) + 1;
      return { ...m, votes };
    });
  return { ...feed, today: patch(feed.today), upcoming: patch(feed.upcoming) };
}

const Section = ({ emoji, title, subtitle, children }) => {
  const c = useThemeColors();
  return (
    <View style={{ marginTop: 22 }}>
      <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
        <Text style={{ fontSize: 19, fontWeight: '900', color: c.text }}>
          {emoji} {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }}>{subtitle}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
};

const Flag = ({ code, size = 30 }) => (
  <Text style={{ fontSize: size }}>{flagEmoji(code) || '🏳️'}</Text>
);

const TodayChip = ({ match, styles, c }) => {
  const finished = match.status === 'finished';
  const live = match.status === 'live';
  return (
    <View style={styles.chip}>
      <View style={[styles.chipBadge, { backgroundColor: live ? '#EF4444' : finished ? c.textMuted : PITCH }]}>
        <Text style={styles.chipBadgeText}>
          {live ? '🔴 LIVE' : finished ? 'FULL TIME' : formatKickoff(match.kickoffISO)}
        </Text>
      </View>
      <View style={styles.chipTeamRow}>
        <Flag code={match.code1} size={26} />
        <Text style={[styles.chipTeam, { color: c.text }]} numberOfLines={1}>{shortLabel(match.team1)}</Text>
        {(finished || live) && <Text style={[styles.chipScore, { color: c.text }]}>{match.score1 ?? 0}</Text>}
      </View>
      <View style={styles.chipTeamRow}>
        <Flag code={match.code2} size={26} />
        <Text style={[styles.chipTeam, { color: c.text }]} numberOfLines={1}>{shortLabel(match.team2)}</Text>
        {(finished || live) && <Text style={[styles.chipScore, { color: c.text }]}>{match.score2 ?? 0}</Text>}
      </View>
    </View>
  );
};

const PredictionCard = ({ match, pick, boosted, isPro, onVote, onBoost, styles, c }) => {
  const voted = !!pick;
  const started = match.status === 'live' || match.status === 'finished';
  const locked = voted || started;
  const pct = votePercents(match.votes);

  return (
    <View style={styles.card}>
      {/* meta pill */}
      <View style={styles.metaRow}>
        <View style={styles.metaPill}>
          <Text style={styles.metaPillText}>{match.group || match.round || 'Match'}</Text>
        </View>
        <Text style={[styles.metaTime, { color: c.textMuted }]}>{formatKickoff(match.kickoffISO)}</Text>
      </View>

      {!locked ? (
        <>
          {/* Big tap-to-pick team tiles */}
          <View style={styles.pickRow}>
            <TouchableOpacity style={styles.teamTile} activeOpacity={0.8} onPress={() => onVote(match, 'home')}>
              <Flag code={match.code1} size={42} />
              <Text style={[styles.teamTileName, { color: c.text }]} numberOfLines={2}>{match.team1}</Text>
            </TouchableOpacity>

            <View style={styles.vsBadge}><Text style={styles.vsText}>VS</Text></View>

            <TouchableOpacity style={styles.teamTile} activeOpacity={0.8} onPress={() => onVote(match, 'away')}>
              <Flag code={match.code2} size={42} />
              <Text style={[styles.teamTileName, { color: c.text }]} numberOfLines={2}>{match.team2}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.drawBtn} activeOpacity={0.8} onPress={() => onVote(match, 'draw')}>
            <Text style={styles.drawBtnText}>🤝  It's a Draw</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Chunky result bars */}
          <ResultBar label={match.team1} code={match.code1} value={pct.home} mine={pick === 'home'} styles={styles} c={c} />
          <ResultBar label="Draw" code={null} value={pct.draw} mine={pick === 'draw'} draw styles={styles} c={c} />
          <ResultBar label={match.team2} code={match.code2} value={pct.away} mine={pick === 'away'} styles={styles} c={c} />

          {voted ? (
            <Text style={styles.pickedNote}>
              🎉 Nice! You picked{' '}
              <Text style={{ fontWeight: '900', color: PICK }}>
                {pick === 'home' ? match.team1 : pick === 'away' ? match.team2 : 'a draw'}
              </Text>
              {pct.total > 1 ? `  ·  ${pct.total.toLocaleString()} fans voted` : ''}
            </Text>
          ) : (
            <Text style={[styles.pickedNote, { color: c.textMuted }]}>⏳ Voting closed — game has kicked off</Text>
          )}

          {/* Rewarded 2× boost — only for a live pick before kickoff */}
          {voted && !started && (
            boosted ? (
              <View style={styles.boostedTag}>
                <Text style={styles.boostedTagText}>🔥 2× points locked in!</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.boostBtn} activeOpacity={0.85} onPress={() => onBoost(match.id)}>
                <Text style={styles.boostBtnText}>
                  🔥 Double my points{isPro ? '' : '  ·  watch ad'}
                </Text>
              </TouchableOpacity>
            )
          )}
        </>
      )}
    </View>
  );
};

const ResultBar = ({ label, code, value, mine, draw, styles, c }) => (
  <View style={styles.barRow}>
    <View style={[styles.barTrack, { backgroundColor: c.bgAlt }]}>
      <View
        style={[
          styles.barFill,
          { width: `${Math.max(value, 3)}%`, backgroundColor: mine ? PICK : draw ? '#FCD34D' : c.borderAccent },
        ]}
      />
      <View style={styles.barContent}>
        <Text style={styles.barFlag}>{draw ? '🤝' : (flagEmoji(code) || '🏳️')}</Text>
        <Text style={[styles.barLabel, { color: c.text }]} numberOfLines={1}>{shortLabel(label)}</Text>
        {mine && <Text style={styles.barMine}>✓ you</Text>}
        <Text style={[styles.barPct, { color: c.text }]}>{value}%</Text>
      </View>
    </View>
  </View>
);

const ResultCard = ({ match, pick, styles, c }) => {
  const outcome = pickOutcome(match, pick);
  const won = match.status === 'finished' && Number(match.score1) > Number(match.score2);
  const lost = match.status === 'finished' && Number(match.score1) < Number(match.score2);
  return (
    <View style={styles.resultCard}>
      <View style={{ flex: 1 }}>
        <View style={styles.resultLine}>
          <Flag code={match.code1} size={22} />
          <Text style={[styles.resultName, { color: c.text, fontWeight: won ? '900' : '600' }]}>{shortLabel(match.team1)}</Text>
          <Text style={[styles.resultScoreBox, { color: c.text }]}>{match.score1 ?? 0}</Text>
        </View>
        <View style={styles.resultLine}>
          <Flag code={match.code2} size={22} />
          <Text style={[styles.resultName, { color: c.text, fontWeight: lost ? '900' : '600' }]}>{shortLabel(match.team2)}</Text>
          <Text style={[styles.resultScoreBox, { color: c.text }]}>{match.score2 ?? 0}</Text>
        </View>
        <TouchableOpacity style={styles.hlBtn} activeOpacity={0.7} onPress={() => openHighlights(match)}>
          <Text style={styles.hlBtnText}>▶  Highlights</Text>
        </TouchableOpacity>
      </View>
      {outcome && (
        <View style={[styles.outBadge, { backgroundColor: outcome === 'win' ? PICK : '#EF4444' }]}>
          <Text style={styles.outBadgeText}>{outcome === 'win' ? '🎉 Called it!' : '😅 Missed'}</Text>
        </View>
      )}
    </View>
  );
};

const ChampionPicker = ({ teams, champion, championTeam, outcome, onPick, styles, c }) => {
  if (champion && championTeam) {
    return (
      <View style={styles.champPickedCard}>
        <Text style={styles.champBigFlag}>{flagEmoji(championTeam.code) || '🏆'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.champPickedLabel, { color: c.textSecondary }]}>Your champion 👑</Text>
          <Text style={[styles.champPickedName, { color: c.text }]}>{championTeam.name}</Text>
          {outcome === 'win' && <Text style={styles.champWin}>🎉 Champion! +50 pts</Text>}
          {outcome === 'loss' && <Text style={styles.champLoss}>😅 Didn't win it</Text>}
        </View>
        {/* Lock the change option once the Final has decided the winner */}
        {!outcome && (
          <TouchableOpacity onPress={() => onPick({ name: null })} activeOpacity={0.7}>
            <Text style={[styles.champChange, { color: c.textMuted }]}>Change</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
  return (
    <FlatList
      horizontal
      data={teams}
      keyExtractor={(t) => t.name}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 14 }}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.champChip} activeOpacity={0.8} onPress={() => onPick(item)}>
          <Text style={styles.champChipFlag}>{flagEmoji(item.code) || '🏳️'}</Text>
          <Text style={[styles.champChipName, { color: c.text }]} numberOfLines={1}>{shortLabel(item.name)}</Text>
        </TouchableOpacity>
      )}
    />
  );
};

const GroupCard = ({ name, rows, styles, c }) => (
  <View style={styles.groupCard}>
    <Text style={[styles.groupTitle, { color: c.text }]}>{name}</Text>
    {/* header */}
    <View style={styles.groupHeadRow}>
      <Text style={[styles.gPos, { color: c.textMuted }]}>#</Text>
      <Text style={[styles.gTeam, { color: c.textMuted }]}>Team</Text>
      <Text style={[styles.gCol, { color: c.textMuted }]}>P</Text>
      <Text style={[styles.gCol, { color: c.textMuted }]}>GD</Text>
      <Text style={[styles.gCol, styles.gPts, { color: c.textMuted }]}>Pts</Text>
    </View>
    {(rows || []).map((t, i) => {
      const qualifies = i < 2; // top 2 advance
      return (
        <View key={t.name} style={[styles.groupRow, qualifies && styles.groupRowQ]}>
          <Text style={[styles.gPos, { color: qualifies ? PICK : c.textSecondary, fontWeight: '800' }]}>{i + 1}</Text>
          <Text style={styles.gFlag}>{flagEmoji(t.code) || '🏳️'}</Text>
          <Text style={[styles.gTeam, { color: c.text }]} numberOfLines={1}>{shortLabel(t.name)}</Text>
          <Text style={[styles.gCol, { color: c.textSecondary }]}>{t.P}</Text>
          <Text style={[styles.gCol, { color: c.textSecondary }]}>{t.GD > 0 ? `+${t.GD}` : t.GD}</Text>
          <Text style={[styles.gCol, styles.gPts, { color: c.text }]}>{t.Pts}</Text>
        </View>
      );
    })}
    <Text style={[styles.groupFoot, { color: c.textMuted }]}>Top 2 advance ✅</Text>
  </View>
);

const ShareStat = ({ value, label }) => (
  <View style={{ alignItems: 'center', flex: 1 }}>
    <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff' }}>{value}</Text>
    <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '700' }}>{label}</Text>
  </View>
);

const makeStyles = (c, isDark) =>
  StyleSheet.create({
    root: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // Hero
    hero: {
      flexDirection: 'row', alignItems: 'center',
      marginHorizontal: 12, marginTop: 10, marginBottom: 14, padding: 16, borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: '#5B21B6', // fallback if the gradient fails
    },
    heroTrophy: { fontSize: 34, marginRight: 12 },
    heroTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
    heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.92)', marginTop: 2, fontWeight: '600' },
    heroCountPill: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
    heroCountNum: { fontSize: 18, fontWeight: '900', color: '#fff' },
    heroCountLbl: { fontSize: 10, color: '#fff', fontWeight: '700' },

    // Empty
    emptyBox: { alignItems: 'center', paddingVertical: 56, paddingHorizontal: 24 },
    emptyIcon: { fontSize: 52, marginBottom: 10 },
    emptyTitle: { fontSize: 18, fontWeight: '900', marginBottom: 4 },
    emptyText: { fontSize: 14, textAlign: 'center' },

    // Today chip
    chip: {
      width: 150, padding: 12, marginRight: 12, borderRadius: 18,
      backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    chipBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 10 },
    chipBadgeText: { fontSize: 10, fontWeight: '900', color: '#fff' },
    chipTeamRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
    chipTeam: { fontSize: 14, fontWeight: '700', marginLeft: 8, flex: 1 },
    chipScore: { fontSize: 16, fontWeight: '900', marginLeft: 6 },

    // Prediction card
    card: {
      width: CARD_W, marginRight: 12, padding: 16, borderRadius: 22,
      backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    metaPill: { backgroundColor: 'rgba(22,163,74,0.14)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    metaPillText: { fontSize: 11, fontWeight: '800', color: isDark ? '#4ADE80' : PITCH_DK },
    metaTime: { fontSize: 12, fontWeight: '700' },

    pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    teamTile: {
      flex: 1, alignItems: 'center', paddingVertical: 16, paddingHorizontal: 6, borderRadius: 18,
      backgroundColor: c.bgAlt, borderWidth: 2, borderColor: c.border,
    },
    teamTileName: { fontSize: 14, fontWeight: '800', marginTop: 8, textAlign: 'center' },
    vsBadge: {
      width: 38, height: 38, borderRadius: 19, marginHorizontal: 8,
      backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center',
    },
    vsText: { fontSize: 13, fontWeight: '900', color: '#fff' },

    drawBtn: {
      marginTop: 12, paddingVertical: 12, borderRadius: 16, alignItems: 'center',
      backgroundColor: c.bgAlt, borderWidth: 2, borderColor: c.border,
    },
    drawBtnText: { fontSize: 14, fontWeight: '800', color: c.textSecondary },

    // Result bars
    barRow: { marginBottom: 10 },
    barTrack: { height: 44, borderRadius: 14, overflow: 'hidden', justifyContent: 'center' },
    barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 14 },
    barContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
    barFlag: { fontSize: 22 },
    barLabel: { fontSize: 15, fontWeight: '800', marginLeft: 10, flex: 1 },
    barMine: { fontSize: 11, fontWeight: '900', color: '#fff', backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden', marginRight: 8 },
    barPct: { fontSize: 15, fontWeight: '900', minWidth: 44, textAlign: 'right' },

    pickedNote: { fontSize: 13, marginTop: 8, color: c.textSecondary, fontWeight: '600' },
    boostBtn: {
      marginTop: 12, paddingVertical: 11, borderRadius: 14, alignItems: 'center',
      backgroundColor: 'rgba(245,158,11,0.16)', borderWidth: 1.5, borderColor: GOLD,
    },
    boostBtnText: { fontSize: 14, fontWeight: '900', color: isDark ? '#FCD34D' : '#B45309' },
    boostedTag: {
      marginTop: 12, paddingVertical: 9, borderRadius: 14, alignItems: 'center',
      backgroundColor: 'rgba(245,158,11,0.16)',
    },
    boostedTagText: { fontSize: 13, fontWeight: '900', color: isDark ? '#FCD34D' : '#B45309' },

    // Result card
    resultCard: {
      width: RESULT_W, marginRight: 12,
      padding: 14, borderRadius: 18, backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    resultLine: { flexDirection: 'row', alignItems: 'center', marginVertical: 3 },
    resultName: { fontSize: 15, marginLeft: 10, flex: 1 },
    resultScoreBox: { fontSize: 18, fontWeight: '900', marginLeft: 8 },
    outBadge: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, marginTop: 10, alignSelf: 'flex-start' },
    outBadgeText: { fontSize: 12, fontWeight: '900', color: '#fff' },

    // Leaderboard
    lbCard: {
      marginHorizontal: 12, borderRadius: 18, overflow: 'hidden',
      backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    lbRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 11,
      borderBottomWidth: 1, borderBottomColor: c.divider,
    },
    lbRowMe: { backgroundColor: 'rgba(22,163,74,0.12)' },
    lbRank: { width: 30, fontSize: 14, fontWeight: '900', color: c.textSecondary, textAlign: 'center' },
    lbRankTop: { fontSize: 18 },
    lbName: { flex: 1, fontSize: 14, fontWeight: '700', marginLeft: 10 },
    lbPts: { fontSize: 14, fontWeight: '900', color: PITCH },
    lbEmpty: {
      marginHorizontal: 12, padding: 22, borderRadius: 18, alignItems: 'center',
      backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    lbEmptyIcon: { fontSize: 34, marginBottom: 8 },
    lbEmptyText: { fontSize: 13, textAlign: 'center', fontWeight: '600' },

    // Group standings card
    groupCard: {
      width: CARD_W, marginRight: 12, padding: 14, borderRadius: 18,
      backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    groupTitle: { fontSize: 16, fontWeight: '900', marginBottom: 10 },
    groupHeadRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 6, marginBottom: 2 },
    groupRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderRadius: 8, paddingHorizontal: 4 },
    groupRowQ: { backgroundColor: 'rgba(22,163,74,0.10)' },
    gPos: { width: 20, fontSize: 13, textAlign: 'center' },
    gFlag: { fontSize: 18, marginHorizontal: 6 },
    gTeam: { flex: 1, fontSize: 14, fontWeight: '700' },
    gCol: { width: 34, fontSize: 13, fontWeight: '700', textAlign: 'center' },
    gPts: { fontWeight: '900' },
    groupFoot: { fontSize: 11, marginTop: 10, fontStyle: 'italic' },

    // Champion picker
    champChip: {
      width: 84, alignItems: 'center', paddingVertical: 12, marginRight: 10, borderRadius: 16,
      backgroundColor: c.cardBg, borderWidth: 2, borderColor: c.cardBorder,
    },
    champChipFlag: { fontSize: 30 },
    champChipName: { fontSize: 12, fontWeight: '800', marginTop: 6 },
    champPickedCard: {
      flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, padding: 16, borderRadius: 18,
      backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 2, borderColor: GOLD,
    },
    champBigFlag: { fontSize: 40, marginRight: 14 },
    champPickedLabel: { fontSize: 12, fontWeight: '700' },
    champPickedName: { fontSize: 20, fontWeight: '900', marginTop: 2 },
    champChange: { fontSize: 13, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 6 },
    champWin: { fontSize: 13, fontWeight: '900', color: PICK, marginTop: 4 },
    champLoss: { fontSize: 13, fontWeight: '700', color: c.textMuted, marginTop: 4 },

    // Highlights
    hlBtn: { marginTop: 8, alignSelf: 'flex-start' },
    hlBtnText: { fontSize: 12, fontWeight: '800', color: PITCH },

    // Share card
    shareCard: {
      marginHorizontal: 12, padding: 20, borderRadius: 22, backgroundColor: '#5B21B6', alignItems: 'center',
    },
    shareTitle: { fontSize: 22, fontWeight: '900', color: '#fff' },
    shareApp: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.8)', marginBottom: 14 },
    shareChampRow: { alignItems: 'center', marginBottom: 14 },
    shareChampLabel: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
    shareChampTeam: { fontSize: 20, fontWeight: '900', color: '#fff', marginTop: 2 },
    shareStatsRow: { flexDirection: 'row', alignSelf: 'stretch', marginBottom: 12 },
    shareTag: { fontSize: 14, fontWeight: '800', color: GOLD },
    shareBtn: {
      marginHorizontal: 12, marginTop: 12, paddingVertical: 14, borderRadius: 16, alignItems: 'center',
      backgroundColor: '#6D28D9',
    },
    shareBtnText: { fontSize: 15, fontWeight: '900', color: '#fff' },
  });

export default WorldCupScreen;
