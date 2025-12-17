// GameResults.jsx
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';

const GameResults = ({ roomData, currentUser }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  // Calculate leaderboard
  const leaderboard = useMemo(() => {
    if (!roomData?.gameData?.scores || !roomData?.players) return [];

    const scores = roomData.gameData.scores;
    const players = roomData.players;

    return Object.entries(players)
      .map(([playerId, playerData]) => ({
        id: playerId,
        name: playerData.displayName || 'Anonymous',
        avatar: playerData.avatar,
        score: scores[playerId] || 0,
        isCurrentUser: playerId === currentUser?.id,
        isHost: playerId === roomData.hostId,
      }))
      .sort((a, b) => b.score - a.score);
  }, [roomData?.gameData?.scores, roomData?.players, currentUser?.id, roomData?.hostId]);

  const currentRound = roomData?.gameData?.currentRound || 0;
  const totalRounds = roomData?.gameData?.totalRounds || 5;
  const isGameFinished = roomData?.status === 'finished';

  // Get round results
  const roundResults = useMemo(() => {
    if (!roomData?.gameData?.answers || !roomData?.gameData?.challenges) return null;
    
    const round = currentRound;
    const answers = roomData.gameData.answers[round] || {};
    const challenge = roomData.gameData.challenges[round];

    if (!challenge) return null;

    return {
      round,
      challenge,
      answers: Object.entries(answers).map(([playerId, answerData]) => ({
        playerId,
        playerName: roomData.players?.[playerId]?.displayName || 'Anonymous',
        selectedAnswer: answerData.selectedAnswer,
        isCorrect: answerData.isCorrect,
        timestamp: answerData.timestamp,
      })),
    };
  }, [roomData?.gameData?.answers, roomData?.gameData?.challenges, currentRound, roomData?.players]);

  return (
    <View style={styles.container}>
      {/* Compact Leaderboard */}
      <View style={styles.compactHeader}>
        <Icon name="trophy" size={18} color="#F59E0B" />
        <Text style={[styles.compactTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
          {isGameFinished ? 'Final Results' : 'Scores'}
        </Text>
      </View>

      <View style={styles.compactLeaderboard}>
        {leaderboard.map((player, index) => {
          const isTopThree = index < 3;
          const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32']; // Gold, Silver, Bronze

          return (
            <View
              key={player.id}
              style={[
                styles.compactLeaderboardItem,
                {
                  backgroundColor: player.isCurrentUser
                    ? isDarkMode ? '#2a2a2a' : '#f3f4f6'
                    : 'transparent',
                },
              ]}
            >
              {isTopThree ? (
                <View
                  style={[
                    styles.compactMedal,
                    { backgroundColor: medalColors[index] },
                  ]}
                >
                  <Text style={styles.compactMedalText}>{index + 1}</Text>
                </View>
              ) : (
                <Text style={[styles.compactRank, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                  {index + 1}
                </Text>
              )}

              <Image
                source={{
                  uri:
                    player.avatar ||
                    'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                }}
                style={styles.compactAvatar}
              />

              <Text style={[styles.compactPlayerName, { color: isDarkMode ? '#fff' : '#000' }]} numberOfLines={1}>
                {player.name}
                {player.isHost && ' 👑'}
                {player.isCurrentUser && ' (You)'}
              </Text>

              <View style={styles.compactScoreContainer}>
                <Icon name="star" size={14} color="#F59E0B" />
                <Text style={[styles.compactScore, { color: isDarkMode ? '#fff' : '#000' }]}>
                  {player.score}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Compact Round Results */}
      {roundResults && (
        <View style={styles.compactRoundResults}>
          <Text style={[styles.compactRoundTitle, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            Round {roundResults.round}: {roundResults.challenge.correctAnswer}
          </Text>
          <View style={styles.compactAnswersList}>
            {roundResults.answers.map((answer) => (
              <View
                key={answer.playerId}
                style={styles.compactAnswerItem}
              >
                <Text style={[styles.compactAnswerName, { color: isDarkMode ? '#fff' : '#000' }]} numberOfLines={1}>
                  {answer.playerName}
                </Text>
                {answer.isCorrect ? (
                  <Icon name="checkmark-circle" size={16} color="#10B981" />
                ) : (
                  <Icon name="close-circle" size={16} color="#EF4444" />
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Compact Progress */}
      {!isGameFinished && (
        <View style={styles.compactProgress}>
          <View style={styles.compactProgressBar}>
            <View
              style={[
                styles.compactProgressFill,
                {
                  width: `${(currentRound / totalRounds) * 100}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.compactProgressText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            {currentRound}/{totalRounds}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  compactTitle: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  compactLeaderboard: {
    gap: 4,
  },
  compactLeaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    marginBottom: 2,
    gap: 8,
  },
  compactRank: {
    fontSize: 12,
    fontFamily: 'Lato-Bold',
    width: 20,
    textAlign: 'center',
  },
  compactMedal: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactMedalText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Lato-Bold',
  },
  compactAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  compactPlayerName: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
    flex: 1,
  },
  compactScoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compactScore: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  compactRoundResults: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  compactRoundTitle: {
    fontSize: 11,
    fontFamily: 'Lato-Regular',
    marginBottom: 6,
  },
  compactAnswersList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  compactAnswerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    gap: 4,
  },
  compactAnswerName: {
    fontSize: 11,
    fontFamily: 'Lato-Regular',
    maxWidth: 80,
  },
  compactProgress: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactProgressBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  compactProgressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#8B5CF6',
  },
  compactProgressText: {
    fontSize: 11,
    fontFamily: 'Lato-Bold',
    minWidth: 30,
  },
});

export default GameResults;

