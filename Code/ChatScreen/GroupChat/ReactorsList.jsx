import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import { getCachedProfile, warmProfileCache } from '../../Helper/profileCache';

// Staff-only "who reacted" list for the message long-press drawer. Mods asked
// for it to act on reaction spam (bugs LOG 2026-10-23): the bubbles only show
// counts. Public chat reactions are not live, so `loadReactions` re-reads this
// one message's rows when the drawer opens; group chat passes none (its
// reactions arrive with the realtime row).
const ReactorsList = ({ message, loadReactions, onUserPress, onClose, isDarkMode }) => {
    const { t } = useTranslation();
    const { appdatabase } = useGlobalState();
    const [reactions, setReactions] = useState(message?.reactions || {});
    const [loading, setLoading] = useState(!!loadReactions);
    const [profileVersion, setProfileVersion] = useState(0);

    useEffect(() => {
        if (!loadReactions || !message?.id) return undefined;
        let cancelled = false;
        loadReactions(message.id)
            .then((fresh) => { if (!cancelled && fresh) setReactions(fresh); })
            .catch(() => { })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [loadReactions, message?.id]);

    const uids = useMemo(() => Object.keys(reactions || {}), [reactions]);

    useEffect(() => {
        if (!appdatabase) return undefined;
        const uncached = uids.filter((uid) => !getCachedProfile(uid));
        if (uncached.length === 0) return undefined;
        let cancelled = false;
        warmProfileCache(appdatabase, uncached)
            .then(() => { if (!cancelled) setProfileVersion((v) => v + 1); })
            .catch(() => { });
        return () => { cancelled = true; };
    }, [uids, appdatabase]);

    const rows = useMemo(() => uids.map((uid) => {
        const profile = getCachedProfile(uid);
        return {
            uid,
            emoji: reactions[uid],
            name: profile?.displayName || t('chat.anonymous'),
            avatar: profile?.avatar || null,
        };
        // profileVersion: re-read the cache once warmProfileCache lands.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [uids, reactions, profileVersion, t]);

    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    if (!loading && rows.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>
                {t('chat.who_reacted')}{rows.length > 0 ? ` (${rows.length})` : ''}
            </Text>
            {loading && rows.length === 0 ? (
                <ActivityIndicator size="small" style={styles.loader} />
            ) : (
                <ScrollView style={styles.list} nestedScrollEnabled>
                    {rows.map((row) => (
                        <TouchableOpacity
                            key={row.uid}
                            style={styles.row}
                            activeOpacity={0.6}
                            disabled={!onUserPress}
                            onPress={() => {
                                onClose?.();
                                setTimeout(() => onUserPress({ senderId: row.uid, sender: row.name, avatar: row.avatar }), 100);
                            }}
                        >
                            <Text style={styles.emoji}>{row.emoji}</Text>
                            <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            )}
        </View>
    );
};

const getStyles = (isDark) =>
    StyleSheet.create({
        container: {
            paddingHorizontal: 16,
            paddingTop: 4,
        },
        title: {
            fontSize: 12,
            fontWeight: '700',
            color: isDark ? '#94a3b8' : '#64748b',
            marginBottom: 4,
            marginLeft: 8,
        },
        loader: {
            marginVertical: 8,
        },
        list: {
            maxHeight: 180,
        },
        row: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 7,
            paddingHorizontal: 8,
            gap: 10,
        },
        emoji: {
            fontSize: 16,
            width: 24,
            textAlign: 'center',
        },
        name: {
            flex: 1,
            fontSize: 14,
            color: isDark ? '#e2e8f0' : '#334155',
        },
    });

export default React.memo(ReactorsList);
