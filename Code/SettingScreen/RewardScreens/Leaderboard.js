import React from 'react';
import { View, Text, Image } from 'react-native';
import FramedAvatar from '../../ChatScreen/GroupChat/FramedAvatar';

const Leaderboard = ({ leaderboardData, styles, isDarkMode = false }) => {
    return (
        <View style={styles.tabContent}>
            {leaderboardData.length > 0 ? (
                leaderboardData.map((player, index) => (
                    <View key={player.id} style={styles.leaderboardCard}>
                        <View style={styles.leaderboardCardsub}>
                            <Text style={styles.rankText}>#{index + 1}</Text>
                            <FramedAvatar
                                avatarUri={player.avatar}
                                frame={player.profileFrame || null}
                                isDarkMode={isDarkMode}
                                avatarSize={30}
                            />
                            <Text style={styles.playerName}>{player.name}</Text>
                        </View>
                        <Text style={styles.playerScore}>{player.slots} Slots</Text>
                    </View>
                ))
            ) : (
                <View style={styles.placeholder}>
                    <Text style={styles.placeholderText}>No active slots yet! Be the first 🚀</Text>
                </View>
            )}
        </View>
    );
};

export default Leaderboard;
