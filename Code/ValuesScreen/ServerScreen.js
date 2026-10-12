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
  RefreshControl,
} from 'react-native';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';
import { getDatabase, ref, get } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';

const ServerScreen = ({ selectedTheme }) => {
  const { t } = useTranslation();
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // ✅ Fetch server data from Firebase RTDB (on mount, pull-to-refresh, Try again)
  const fetchServers = useCallback(async (fromPull = false) => {
    try {
      if (fromPull) setRefreshing(true);
      else setLoading(true);
      const serverRef = ref(getDatabase(), 'server');
      const snapshot = await get(serverRef);

      if (!snapshot.exists()) {
        setServers([]);
        setError(null);
        return;
      }

      const serverData = snapshot.val();

      // ✅ Convert Firebase object format to array
      // Format: { "-ON15YX7Hp402i2zC2Aw": { link: "...", name: "..." }, ... }
      const serverList = Object.entries(serverData).map(([id, value]) => ({
        id,
        ...value,
      }));

      setServers(serverList);
      setError(null);
    } catch (err) {
      // Logged only: the raw Firebase text means nothing to a player.
      console.error('Error fetching servers:', err);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const onRefresh = useCallback(() => fetchServers(true), [fetchServers]);

  // ✅ Handle server click
  const handleServerPress = useCallback((server) => {
    if (!server?.link) {
      Alert.alert(t('alert.error'), t('chat.server_error'));
      return;
    }

    triggerHapticFeedback('impactLight');

    const trimmedUrl = server.link?.trim();
    if (!trimmedUrl) {
      Alert.alert(t('alert.error'), t('server.invalid_link'));
      return;
    }

    Linking.openURL(trimmedUrl).catch(err => {
      console.warn('Failed to open link:', err);
      Alert.alert(t('alert.error'), t('chat.server_open_failed'));
    });
  }, [triggerHapticFeedback, t]);

  // ✅ Get background color based on server index
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
        <Text style={styles.loadingText}>{t('server.loading')}</Text>
      </View>
    );
  }

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={isDarkMode ? '#fff' : '#000'}
    />
  );

  if (error) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.errorContainer} refreshControl={refreshControl}>
        <Icon name="alert-circle-outline" size={48} color={isDarkMode ? '#fff' : '#000'} />
        <Text style={styles.errorText}>{t('server.load_failed')}</Text>
        <Text style={styles.errorSubtext}>{t('value.history.error_body')}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => fetchServers()} activeOpacity={0.8}>
          <Text style={styles.retryText}>{t('value.history.retry')}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (servers.length === 0) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.emptyContainer} refreshControl={refreshControl}>
        <Icon name="server-outline" size={48} color={isDarkMode ? '#666' : '#999'} />
        <Text style={styles.emptyText}>{t('server.empty')}</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      <Text style={styles.headerTitle}>{t('server.title')}</Text>

      {/* Server Cards - Display each server from Firebase */}
      <View style={styles.serversRow}>
        {servers.map((server, index) => (
          <TouchableOpacity
            key={server.id || `server-${index}`}
            style={styles.serverPill}
            onPress={() => handleServerPress(server)}
            activeOpacity={0.8}
          >
            {/* Icon with background color */}
            <View style={[styles.iconContainer, { backgroundColor: getBackgroundColor(index) }]}>
              <Image resizeMethod="resize"
                source={require('../../assets/splashscreen.webp')}
                style={styles.icon}
                resizeMode="contain"
              />
            </View>

            {/* Server Name from Firebase */}
            <Text style={styles.serverLabel} numberOfLines={1}>
              {server.name || t('server.default_name')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#f5f5f5',
  },
  contentContainer: {
    padding: 8,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#0f172a' : '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: isDarkMode ? '#fff' : '#000',

  },
  errorContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#0f172a' : '#f5f5f5',
    padding: 20,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#000',
  },
  errorSubtext: {
    marginTop: 8,
    fontSize: 12,

    color: isDarkMode ? '#999' : '#666',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: isDarkMode ? '#333' : '#ddd',
    backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
  },
  retryText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#000',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#0f172a' : '#f5f5f5',
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: isDarkMode ? '#999' : '#666',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
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
    backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
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
    fontWeight: 'bold',
    color: isDarkMode ? '#fff' : '#000',
    flex: 1,
  },
});

export default React.memo(ServerScreen);
