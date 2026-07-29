import React, { useMemo, useCallback } from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import {
    Modal,
    View,
    Text,
    TouchableOpacity,
    Pressable,
    StyleSheet,
    Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import { useTranslation } from 'react-i18next';

const REACTION_EMOJIS = ['❤️', '🔥', '😍', '💀', '🎯'];
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MessageActionDrawer = ({
    visible,
    message,
    onClose,
    onReaction,
    onCopy,
    onReply,
    onTranslate,
    onReport,
    onDelete,
    onDeleteAll,
    onPinMessage,
    isAdminOrMod,
    userId,
    isDarkMode,
    // Public chat switches this off: regular users must not be able to delete
    // their own messages there. Admin/mod delete below is unaffected.
    allowSelfDelete = true,
}) => {
    const { t } = useTranslation();

    // Get the user's current reaction on this message
    const myReaction = useMemo(() => {
        if (!message?.reactions || !userId) return null;
        return message.reactions[userId] || null;
    }, [message?.reactions, userId]);

    // Count reactions by emoji
    const reactionCounts = useMemo(() => {
        if (!message?.reactions) return {};
        const counts = {};
        Object.values(message.reactions).forEach(emoji => {
            counts[emoji] = (counts[emoji] || 0) + 1;
        });
        return counts;
    }, [message?.reactions]);

    const handleEmojiTap = useCallback(
        (emoji) => {
            if (onReaction && message?.id) {
                onReaction(message.id, emoji);
            }
            onClose();
        },
        [onReaction, message?.id, onClose],
    );

    const handleAction = useCallback(
        (action) => {
            onClose();
            if (action && typeof action === 'function') {
                // Small delay so drawer closes smoothly
                setTimeout(() => action(message), 100);
            }
        },
        [onClose, message],
    );

    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    if (!visible || !message) return null;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <SwipeableBottomDrawer
                    onClose={onClose}
                    isDarkMode={isDarkMode}
                    style={styles.drawer}
                >
                    {/* ── Emoji Reaction Row ── */}
                    <View style={styles.emojiRow}>
                        {REACTION_EMOJIS.map((emoji) => {
                            const isActive = myReaction === emoji;
                            const count = reactionCounts[emoji] || 0;
                            return (
                                <TouchableOpacity
                                    key={emoji}
                                    onPress={() => handleEmojiTap(emoji)}
                                    activeOpacity={0.7}
                                    style={[styles.emojiBtn, isActive && styles.emojiBtnActive]}
                                >
                                    <Text style={styles.emojiText}>{emoji}</Text>
                                    {count > 0 && (
                                        <Text style={[styles.emojiCount, isActive && styles.emojiCountActive]}>
                                            {count}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    {/* ── Divider ── */}
                    <View style={styles.divider} />

                    {/* ── Action Buttons ── */}
                    <View style={styles.actionsList}>
                        {/* Copy */}
                        {!!message?.text && (
                            <TouchableOpacity
                                style={styles.actionRow}
                                activeOpacity={0.6}
                                onPress={() => handleAction(onCopy)}
                            >
                                <Icon name="copy-outline" size={20} color={isDarkMode ? '#e2e8f0' : '#334155'} />
                                <Text style={styles.actionText}>{t('chat.copy')}</Text>
                            </TouchableOpacity>
                        )}

                        {/* Reply */}
                        {userId && onReply && (
                            <TouchableOpacity
                                style={styles.actionRow}
                                activeOpacity={0.6}
                                onPress={() => handleAction(onReply)}
                            >
                                <Icon name="arrow-undo-outline" size={20} color={isDarkMode ? '#e2e8f0' : '#334155'} />
                                <Text style={styles.actionText}>{t('chat.reply')}</Text>
                            </TouchableOpacity>
                        )}

                        {/* Translate */}
                        {onTranslate && (
                            <TouchableOpacity
                                style={styles.actionRow}
                                activeOpacity={0.6}
                                onPress={() => handleAction(onTranslate)}
                            >
                                <Icon name="language-outline" size={20} color={isDarkMode ? '#e2e8f0' : '#334155'} />
                                <Text style={styles.actionText}>{t('chat.translate')}</Text>
                            </TouchableOpacity>
                        )}

                        {/* Report */}
                        {onReport && (
                            <TouchableOpacity
                                style={styles.actionRow}
                                activeOpacity={0.6}
                                onPress={() => handleAction(onReport)}
                            >
                                <Icon name="flag-outline" size={20} color={isDarkMode ? '#e2e8f0' : '#334155'} />
                                <Text style={styles.actionText}>{t('chat.report')}</Text>
                            </TouchableOpacity>
                        )}

                        {/* ── Admin / Mod Actions ── */}
                        {isAdminOrMod && (
                            <>
                                <View style={styles.divider} />

                                {/* Delete */}
                                {onDelete && (
                                    <TouchableOpacity
                                        style={styles.actionRow}
                                        activeOpacity={0.6}
                                        onPress={() => {
                                            onClose();
                                            setTimeout(() => onDelete(message.id), 100);
                                        }}
                                    >
                                        <Icon name="trash-outline" size={20} color="#EF4444" />
                                        <Text style={[styles.actionText, { color: '#EF4444' }]}>{t('chat.delete')}</Text>
                                    </TouchableOpacity>
                                )}

                                {/* Delete All */}
                                {onDeleteAll && (
                                    <TouchableOpacity
                                        style={styles.actionRow}
                                        activeOpacity={0.6}
                                        onPress={() => {
                                            onClose();
                                            setTimeout(() => onDeleteAll(message.senderId), 100);
                                        }}
                                    >
                                        <Icon name="trash-bin-outline" size={20} color="#EF4444" />
                                        <Text style={[styles.actionText, { color: '#EF4444' }]}>{t('chat.delete_all')}</Text>
                                    </TouchableOpacity>
                                )}

                                {/* Pin */}
                                {onPinMessage && (
                                    <TouchableOpacity
                                        style={styles.actionRow}
                                        activeOpacity={0.6}
                                        onPress={() => handleAction(onPinMessage)}
                                    >
                                        <Icon name="pin-outline" size={20} color={isDarkMode ? '#e2e8f0' : '#334155'} />
                                        <Text style={styles.actionText}>{t('chat.pin_message')}</Text>
                                    </TouchableOpacity>
                                )}
                            </>
                        )}

                        {/* Delete own message (non-admin) — hidden where the host
                            screen passes allowSelfDelete={false}. */}
                        {allowSelfDelete && !isAdminOrMod && message?.senderId === userId && onDelete && (
                            <>
                                <View style={styles.divider} />
                                <TouchableOpacity
                                    style={styles.actionRow}
                                    activeOpacity={0.6}
                                    onPress={() => {
                                        onClose();
                                        setTimeout(() => onDelete(message.id), 100);
                                    }}
                                >
                                    <Icon name="trash-outline" size={20} color="#EF4444" />
                                    <Text style={[styles.actionText, { color: '#EF4444' }]}>{t('chat.delete')}</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </SwipeableBottomDrawer>
            </Pressable>
        </Modal>
    );
};

const getStyles = (isDark) =>
    StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            justifyContent: 'flex-end',
        },
        drawer: {
            backgroundColor: isDark ? '#1e293b' : '#ffffff',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingBottom: 34, // safe area
            paddingTop: 8,
            maxHeight: '70%',
        },
        handleBar: {
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: isDark ? '#475569' : '#cbd5e1',
            alignSelf: 'center',
            marginBottom: 12,
        },
        emojiRow: {
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 20,
            paddingVertical: 8,
        },
        emojiBtn: {
            width: 52,
            height: 52,
            borderRadius: 16,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: isDark ? '#0f172a' : '#f1f5f9',
        },
        emojiBtnActive: {
            backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
            borderWidth: 2,
            borderColor: isDark ? '#3b82f6' : '#60a5fa',
        },
        emojiText: {
            fontSize: 24,
        },
        emojiCount: {
            fontSize: 10,
            color: isDark ? '#94a3b8' : '#64748b',
            fontWeight: '700',
            marginTop: 1,
        },
        emojiCountActive: {
            color: isDark ? '#93c5fd' : '#2563eb',
        },
        divider: {
            height: 1,
            backgroundColor: isDark ? '#334155' : '#e2e8f0',
            marginHorizontal: 16,
            marginVertical: 6,
        },
        actionsList: {
            paddingHorizontal: 8,
        },
        actionRow: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingVertical: 13,
            paddingHorizontal: 16,
            gap: 14,
            borderRadius: 10,
        },
        actionText: {
            fontSize: 15,
            fontWeight: '500',
            color: isDark ? '#e2e8f0' : '#334155',
        },
    });

export default React.memo(MessageActionDrawer);
