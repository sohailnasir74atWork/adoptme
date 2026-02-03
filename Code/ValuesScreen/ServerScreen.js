import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
  Image,
} from 'react-native';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';

const ServerScreen = ({ selectedTheme }) => {
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ✅ Fetch server data
  useEffect(() => {
    const fetchServers = async () => {
      try {
        setLoading(true);
        const response = await fetch('https://blox-api.b-cdn.net/server.json', {
          method: 'GET',
          cache: 'no-store',
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data)) {
          throw new Error('Invalid data format');
        }
        
        setServers(data);
        setError(null);
      } catch (err) {
        console.error('Error fetching servers:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchServers();
  }, []);

  // ✅ Group servers by name
  const groupedServers = useMemo(() => {
    if (!Array.isArray(servers) || servers.length === 0) return {};
    
    const groups = {};
    servers.forEach((server, index) => {
      const name = server.name || 'Unknown';
      if (!groups[name]) {
        groups[name] = [];
      }
      groups[name].push({
        ...server,
        serverNumber: groups[name].length + 1, // Server 1, Server 2, etc.
      });
    });
    
    return groups;
  }, [servers]);

  // ✅ Handle server click - same logic as Server.js
  const handleServerPress = useCallback((server) => {
    if (!server?.link) {
      Alert.alert('Error', 'Server link not available');
      return;
    }

    triggerHapticFeedback('impactLight');
    
    const trimmedUrl = server.link?.trim();
    if (!trimmedUrl) {
      Alert.alert('Error', 'Invalid server link');
      return;
    }

    // ✅ Same pattern as Server.js - use .catch() instead of try/catch
    Linking.openURL(trimmedUrl).catch(err => {
      console.warn('Failed to open link:', err);
      Alert.alert('Error', 'Failed to open link');
    });
  }, [triggerHapticFeedback]);

  // ✅ Get background color based on server number/index
  const getBackgroundColor = useCallback((index) => {
    const colors = [
      '#FF6B6B', // Red
      '#4ECDC4', // Teal
      '#45B7D1', // Blue
      '#FFA07A', // Light Salmon
      '#98D8C8', // Mint
      '#F7DC6F', // Yellow
      '#BB8FCE', // Purple
      '#85C1E2', // Sky Blue
      '#F8B739', // Orange
      '#52BE80', // Green
    ];
    return colors[index % colors.length];
  }, []);

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={isDarkMode ? '#fff' : '#000'} />
        <Text style={styles.loadingText}>Loading servers...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Icon name="alert-circle-outline" size={48} color={isDarkMode ? '#fff' : '#000'} />
        <Text style={styles.errorText}>Failed to load servers</Text>
        <Text style={styles.errorSubtext}>{error}</Text>
      </View>
    );
  }

  const groupNames = Object.keys(groupedServers);

  if (groupNames.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon name="server-outline" size={48} color={isDarkMode ? '#666' : '#999'} />
        <Text style={styles.emptyText}>No servers available</Text>
      </View>
    );
  }

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {groupNames.map((groupName) => {
        const groupServers = groupedServers[groupName];
        
        return (
          <View key={groupName} style={styles.groupContainer}>
            {/* Group Header */}
            <Text style={styles.groupTitle}>{groupName}</Text>
            
            {/* Server Pills - 2 Column Layout */}
            <View style={styles.serversRow}>
              {groupServers.map((server, index) => (
                <TouchableOpacity
                  key={`${server.link}-${index}`}
                  style={styles.serverPill}
                  onPress={() => handleServerPress(server)}
                  activeOpacity={0.8}
                >
                  {/* Icon with background color */}
                  <View style={[styles.iconContainer, { backgroundColor: getBackgroundColor(index) }]}>
                    <Image
                      source={require('../../assets/splashscreen.webp')}
                      style={styles.icon}
                      resizeMode="contain"
                    />
                  </View>
                  
                  {/* Server Label */}
                  <Text style={styles.serverLabel} numberOfLines={1}>
                    Server {server.serverNumber}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  contentContainer: {
    padding: 8,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: isDarkMode ? '#fff' : '#000',
    fontFamily: 'Lato-Regular',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
    padding: 20,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? '#fff' : '#000',
  },
  errorSubtext: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'Lato-Regular',
    color: isDarkMode ? '#999' : '#666',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#121212' : '#f5f5f5',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: isDarkMode ? '#999' : '#666',
    fontFamily: 'Lato-Regular',
  },
  groupContainer: {
    marginBottom: 32,
  },
  groupTitle: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? '#fff' : '#000',
    marginBottom: 16,
    textAlign: 'center',
  },
  serversRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    width: '48%', // 2 columns with gap
    minHeight: 60,
    borderWidth: 1,
    borderColor: isDarkMode ? '#333' : '#ddd',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  icon: {
    width: 32,
    height: 32,
  },
  serverLabel: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? '#fff' : '#000',
    flex: 1,
  },
});

export default React.memo(ServerScreen);
