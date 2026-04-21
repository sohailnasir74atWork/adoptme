import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
// import { colors, gradients, spacing, typography, borderRadius } from '../../theme/tokens';

const gradients = { header: ['#3B82F6', '#6366F1'] };
const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
const typography = { fontFamily: { bold: 'System', medium: 'System' }, sizes: { xs: 12, lg: 18, xl: 20 } };
const borderRadius = { md: 12, lg: 16 };
const colors = {}; // Not used in this file directly

import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

const GradientHeader = ({
    title,
    titleRight,
    subtitle,
    subtitleStyle,
    showBack,
    onBackPress,
    leftElement,
    rightElement,
    style,
    compact = false,
}) => {
    const navigation = useNavigation();

    const handleBack = () => {
        ReactNativeHapticFeedback.trigger('impactLight');
        if (onBackPress) {
            onBackPress();
        } else {
            navigation.goBack();
        }
    };

    return (
        <LinearGradient
            colors={gradients.header}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.container, compact && styles.containerCompact, style]}
        >
            <SafeAreaView edges={['top']} style={styles.safeArea}>
                <View style={[styles.content, compact && styles.contentCompact]}>
                    {showBack && (
                        <TouchableOpacity
                            onPress={handleBack}
                            style={styles.backButton}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <View style={styles.backCircle}>
                                <Ionicons name="chevron-back" size={18} color="#FFF" />
                            </View>
                        </TouchableOpacity>
                    )}

                    {leftElement || null}
                    <View style={styles.titleBlock}>
                        <View style={styles.titleRow}>
                            <Text style={[styles.title, compact && styles.titleCompact]} numberOfLines={1}>{title}</Text>
                            {titleRight || null}
                        </View>
                        {subtitle && <Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Text>}
                    </View>

                    <View style={styles.right}>
                        {rightElement || null}
                    </View>
                </View>
            </SafeAreaView>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: {
        paddingBottom: 14,
    },
    containerCompact: {
        paddingBottom: 10,
    },
    safeArea: {
        backgroundColor: 'transparent',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingTop: Platform.OS === 'android' ? 4 : 6,
        minHeight: 44,
    },
    contentCompact: {
        paddingTop: 2,
        minHeight: 38,
    },
    backButton: {
        marginRight: 10,
    },
    backCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleBlock: {
        flex: 1,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    title: {
        fontFamily: typography.fontFamily.bold,
        fontSize: typography.sizes.xl,
        color: '#FFFFFF',
        letterSpacing: 0.3,
    },
    titleCompact: {
        fontSize: typography.sizes.lg,
    },
    subtitle: {
        fontFamily: typography.fontFamily.medium,
        fontSize: typography.sizes.xs,
        color: 'rgba(255, 255, 255, 0.7)',
    },
    right: {
        marginLeft: spacing.sm,
    },
});

export default GradientHeader;
