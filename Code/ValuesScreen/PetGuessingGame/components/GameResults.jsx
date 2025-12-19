// GameResults.jsx - Final scores and spin history
import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { ref, get, onValue } from '@react-native-firebase/database';

const GameResults = ({ roomData, currentUser }) => {
  const { theme, appdatabase } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [userPoints, setUserPoints] = useState(null);
  const [userWins, setUserWins] = useState(null);

  // Fetch and listen to user points and wins
  useEffect(() => {
    if (!appdatabase || !currentUser?.id) return;

    const userRef = ref(appdatabase, `users/${currentUser.id}`);
    
    // Initial fetch
    const fetchUserStats = async () => {
      try {
        const snapshot = await get(userRef);
        if (snapshot.exists()) {
          const userData = snapshot.val();
          setUserPoints(userData.rewardPoints || 0);
          setUserWins(userData.petGameWins || 0);
        }
      } catch (error) {
        console.error('Error fetching user stats:', error);
      }
    };

    fetchUserStats();

    // Listen for real-time updates
    const unsubscribe = onValue(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const userData = snapshot.val();
        setUserPoints(userData.rewardPoints || 0);
        setUserWins(userData.petGameWins || 0);
      }
    });

    return () => unsubscribe();
  }, [appdatabase, currentUser?.id]);

  // Calculate leaderboard from scores
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

  const isGameFinished = roomData?.status === 'finished';
  const spinHistory = roomData?.gameData?.spinHistory || [];
  const timeoutReason = roomData?.gameData?.timeoutReason;

  // Get winner
  const winner = useMemo(() => {
    if (!isGameFinished || leaderboard.length === 0 || timeoutReason) return null;
    return leaderboard[0];
  }, [isGameFinished, leaderboard, timeoutReason]);

  return (
    <View style={styles.container}>
      {/* Timeout Message */}
      {timeoutReason && (
        <View style={[styles.timeoutSection, { backgroundColor: isDarkMode ? '#1e1e1e' : '#fef2f2' }]}>
          <Text style={styles.timeoutEmoji}>⏱️</Text>
          <Text style={[styles.timeoutText, { color: isDarkMode ? '#fff' : '#000' }]}>
            Game Ended
          </Text>
          <Text style={[styles.timeoutReason, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            {timeoutReason}
          </Text>
        </View>
      )}

      {/* Winner Announcement */}
      {winner && !timeoutReason && (
        <View style={styles.winnerSection}>
          <Text style={styles.winnerEmoji}>🏆</Text>
          <Text style={[styles.winnerText, { color: isDarkMode ? '#fff' : '#000' }]}>
            {winner.isCurrentUser ? 'You Win!' : `${winner.name} Wins!`}
          </Text>
          <Text style={styles.winnerScore}>
            {Number(winner.score).toLocaleString()} points
          </Text>
          {winner.isCurrentUser && userPoints !== null && (
            <View style={styles.pointsSection}>
              <Text style={[styles.pointsLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                Your Points: <Text style={styles.pointsValue}>{Number(userPoints).toLocaleString()}</Text>
              </Text>
              {userWins !== null && (
                <Text style={[styles.pointsLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                  Total Wins: <Text style={styles.pointsValue}>{userWins}</Text>
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* Leaderboard */}
      <View style={styles.leaderboardSection}>
        <View style={styles.sectionHeader}>
          <Icon name="podium-outline" size={18} color="#8B5CF6" />
          <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
            Final Standings
          </Text>
        </View>

        <View style={styles.leaderboard}>
          {leaderboard.map((player, index) => {
            const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
            const isWinner = index === 0 && isGameFinished;

            return (
              <View
                key={player.id}
                style={[
                  styles.leaderboardItem,
                  {
                    backgroundColor: isWinner
                      ? isDarkMode ? '#3a2a10' : '#fef3c7'
                      : player.isCurrentUser
                        ? isDarkMode ? '#2a2a2a' : '#f3f4f6'
                        : 'transparent',
                  },
                  isWinner && styles.winnerItem,
                ]}
              >
                <View
                  style={[
                    styles.medal,
                    { backgroundColor: medalColors[index] || '#6b7280' },
                  ]}
                >
                  <Text style={styles.medalText}>{index + 1}</Text>
                </View>

                <Image
                  source={{
                    uri:
                      player.avatar ||
                      'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  }}
                  style={styles.avatar}
                />

                <Text 
                  style={[styles.playerName, { color: isDarkMode ? '#fff' : '#000' }]} 
                  numberOfLines={1}
                >
                  {player.name}
                  {player.isCurrentUser && ' (You)'}
                </Text>

                <View style={styles.scoreContainer}>
                  <Text style={[styles.score, isWinner && styles.winnerScoreText]}>
                    {Number(player.score).toLocaleString()}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Spin History */}
      {spinHistory.length > 0 && (
        <View style={styles.historySection}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setIsHistoryExpanded(!isHistoryExpanded)}
            activeOpacity={0.7}
          >
            <Icon name="time-outline" size={18} color="#8B5CF6" />
            <Text style={[styles.sectionTitle, { color: isDarkMode ? '#fff' : '#000' }]}>
              Spin History
            </Text>
            <Icon
              name={isHistoryExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
              size={20}
              color={isDarkMode ? '#fff' : '#000'}
              style={styles.chevronIcon}
            />
          </TouchableOpacity>

          {isHistoryExpanded && (
            <View style={styles.historyList}>
              {spinHistory.map((spin, index) => {
                const playerName = roomData?.players?.[spin.playerId]?.displayName || 'Player';
                
                return (
                  <View key={index} style={styles.historyItem}>
                    <View style={styles.historyRound}>
                      <Text style={[styles.historyRoundText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                        R{spin.round}
                      </Text>
                    </View>
                    <Text 
                      style={[styles.historyPlayer, { color: isDarkMode ? '#fff' : '#000' }]}
                      numberOfLines={1}
                    >
                      {playerName}
                    </Text>
                    <Text style={[styles.historyPet, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]} numberOfLines={1}>
                      {spin.petName}
                    </Text>
                    <Text style={styles.historyValue}>
                      +{Number(spin.petValue).toLocaleString()}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  winnerSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  winnerEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  winnerText: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  winnerScore: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    color: '#F59E0B',
    marginBottom: 8,
  },
  pointsSection: {
    marginTop: 8,
    alignItems: 'center',
    gap: 4,
  },
  pointsLabel: {
    fontSize: 13,
    fontFamily: 'Lato-Regular',
  },
  pointsValue: {
    fontFamily: 'Lato-Bold',
    color: '#10B981',
  },
  leaderboardSection: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
    justifyContent: 'space-between',
    paddingRight: 4,
  },
  chevronIcon: {
    marginLeft: 'auto',
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
  },
  leaderboard: {
    gap: 8,
  },
  leaderboardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 10,
  },
  winnerItem: {
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  medal: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  medalText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Lato-Bold',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  playerName: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    flex: 1,
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  score: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    color: '#10B981',
  },
  winnerScoreText: {
    color: '#F59E0B',
  },
  historySection: {
    marginTop: 8,
  },
  historyList: {
    gap: 6,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    borderRadius: 8,
    gap: 8,
  },
  historyRound: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyRoundText: {
    fontSize: 11,
    fontFamily: 'Lato-Bold',
    color: '#fff',
  },
  historyPlayer: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
    flex: 1,
  },
  historyPet: {
    fontSize: 11,
    fontFamily: 'Lato-Regular',
    flex: 1,
    textAlign: 'right',
  },
  historyValue: {
    fontSize: 13,
    fontFamily: 'Lato-Bold',
    color: '#10B981',
    minWidth: 60,
    textAlign: 'right',
  },
  timeoutSection: {
    alignItems: 'center',
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  timeoutEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  timeoutText: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  timeoutReason: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    textAlign: 'center',
  },
});

export default GameResults;
