import React, { useMemo, useEffect, useRef } from 'react';
import {
    View,
    Text,
    Image,
    StyleSheet,
    Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';

// ── Value Formatter (K / M / B) ────────────────────────
const formatValue = (value) => {
    if (!value || typeof value !== 'number') return '0';
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (value < 1) return value.toFixed(2);
    return value.toLocaleString();
};

// ── Category Colors ────────────────────────────────────
const CATEGORY_COLORS = {
    pets: '#FF6B6B',
    eggs: '#FFA94D',
    vehicles: '#51CF66',
    toys: '#845EF7',
    'pet wear': '#339AF0',
    food: '#20C997',
    strollers: '#F06595',
    gifts: '#FF922B',
    other: '#868E96',
};

const getCategoryColor = (cat) => {
    if (!cat) return '#868E96';
    return CATEGORY_COLORS[cat.toLowerCase()] || '#868E96';
};

// ── Main Component ─────────────────────────────────────
const PortfolioValuation = ({ ownedPets = [], wishlistPets = [], isDarkMode, t }) => {
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(30)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 500,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 60,
                friction: 10,
                useNativeDriver: true,
            }),
        ]).start();
    }, []);

    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    // ── Compute portfolio data ──────────────────────────
    const portfolio = useMemo(() => {
        if (!ownedPets || ownedPets.length === 0) {
            return null;
        }

        const totalValue = ownedPets.reduce((sum, pet) => sum + (Number(pet.value) || 0), 0);
        const totalItems = ownedPets.length;
        const avgValue = totalItems > 0 ? totalValue / totalItems : 0;

        // Category breakdown
        const categoryMap = {};
        ownedPets.forEach((pet) => {
            const cat = (pet.category || 'Other').toLowerCase();
            if (!categoryMap[cat]) {
                categoryMap[cat] = { value: 0, count: 0 };
            }
            categoryMap[cat].value += Number(pet.value) || 0;
            categoryMap[cat].count += 1;
        });

        const categories = Object.entries(categoryMap)
            .map(([name, data]) => ({
                name,
                value: data.value,
                count: data.count,
                percentage: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
                color: getCategoryColor(name),
            }))
            .sort((a, b) => b.value - a.value);

        const bestCategory = categories.length > 0 ? categories[0] : null;

        // Top 3 valuable pets
        const top3 = [...ownedPets]
            .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
            .slice(0, 3);

        // Wishlist
        const wishlistTotal = (wishlistPets || []).reduce(
            (sum, pet) => sum + (Number(pet.value) || 0),
            0
        );
        const wishlistGap = Math.max(0, wishlistTotal - totalValue);

        return {
            totalValue,
            totalItems,
            avgValue,
            categories,
            bestCategory,
            top3,
            wishlistTotal,
            wishlistGap,
        };
    }, [ownedPets, wishlistPets]);

    // ── Empty state ─────────────────────────────────────
    if (!portfolio) {
        return (
            <View style={styles.emptyContainer}>
                <Icon
                    name="wallet-outline"
                    size={28}
                    color={isDarkMode ? '#475569' : '#d1d5db'}
                />
                <Text style={styles.emptyText}>
                    {t('settings.portfolio.empty')}
                </Text>
            </View>
        );
    }

    return (
        <Animated.View
            style={[
                styles.container,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
        >
            {/* ── Header ─────────────────────────────────── */}
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <Icon name="diamond-outline" size={18} color={config.colors.primary} />
                    <Text style={styles.headerTitle}>
                        {t('settings.portfolio.title')}
                    </Text>
                </View>
                <View style={styles.itemCountBadge}>
                    <Text style={styles.itemCountText}>
                        {portfolio.totalItems} {t('settings.portfolio.items')}
                    </Text>
                </View>
            </View>

            {/* ── Total Value Card ───────────────────────── */}
            <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>
                    {t('settings.portfolio.total_value')}
                </Text>
                <Text style={styles.totalValue}>
                    {formatValue(portfolio.totalValue)}
                </Text>
                <View style={styles.avgRow}>
                    <Icon name="analytics-outline" size={12} color={isDarkMode ? '#94a3b8' : '#6b7280'} />
                    <Text style={styles.avgText}>
                        {t('settings.portfolio.avg_value')}: {formatValue(portfolio.avgValue)}
                    </Text>
                </View>
            </View>

            {/* ── Top 3 Most Valuable ────────────────────── */}
            {portfolio.top3.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                        🏆 {t('settings.portfolio.top_items')}
                    </Text>
                    {portfolio.top3.map((pet, index) => (
                        <View key={`top-${pet.id || pet.name}-${index}`} style={styles.topItemRow}>
                            <View style={styles.topItemRank}>
                                <Text style={styles.rankText}>#{index + 1}</Text>
                            </View>
                            <Image
                                source={{
                                    uri: pet.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                                }}
                                style={styles.topItemImage}
                            />
                            <View style={styles.topItemInfo}>
                                <Text style={styles.topItemName} numberOfLines={1}>
                                    {pet.name}
                                </Text>
                                {pet.category && (
                                    <Text style={[styles.topItemCategory, { color: getCategoryColor(pet.category) }]}>
                                        {pet.category}
                                    </Text>
                                )}
                            </View>
                            <Text style={styles.topItemValue}>
                                {formatValue(Number(pet.value) || 0)}
                            </Text>
                        </View>
                    ))}
                </View>
            )}

            {/* ── Category Breakdown ─────────────────────── */}
            {portfolio.categories.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                        📊 {t('settings.portfolio.categories')}
                    </Text>

                    {/* Stacked category bar */}
                    <View style={styles.categoryBarContainer}>
                        {portfolio.categories.map((cat, i) => (
                            <View
                                key={`bar-${cat.name}`}
                                style={[
                                    styles.categoryBarSegment,
                                    {
                                        flex: cat.percentage,
                                        backgroundColor: cat.color,
                                        borderTopLeftRadius: i === 0 ? 6 : 0,
                                        borderBottomLeftRadius: i === 0 ? 6 : 0,
                                        borderTopRightRadius: i === portfolio.categories.length - 1 ? 6 : 0,
                                        borderBottomRightRadius: i === portfolio.categories.length - 1 ? 6 : 0,
                                    },
                                ]}
                            />
                        ))}
                    </View>

                    {/* Category legends */}
                    <View style={styles.categoryLegend}>
                        {portfolio.categories.map((cat) => (
                            <View key={`legend-${cat.name}`} style={styles.legendItem}>
                                <View style={[styles.legendDot, { backgroundColor: cat.color }]} />
                                <Text style={styles.legendText}>
                                    {cat.name.charAt(0).toUpperCase() + cat.name.slice(1)}
                                </Text>
                                <Text style={styles.legendValue}>
                                    {formatValue(cat.value)} ({Math.round(cat.percentage)}%)
                                </Text>
                            </View>
                        ))}
                    </View>
                </View>
            )}

            {/* ── Stats Row ──────────────────────────────── */}
            <View style={styles.statsRow}>
                {portfolio.bestCategory && (
                    <View style={styles.statBox}>
                        <Icon name="trophy-outline" size={16} color="#FFA94D" />
                        <Text style={styles.statLabel}>
                            {t('settings.portfolio.best_category')}
                        </Text>
                        <Text style={styles.statValue}>
                            {portfolio.bestCategory.name.charAt(0).toUpperCase() +
                                portfolio.bestCategory.name.slice(1)}
                        </Text>
                    </View>
                )}
                {wishlistPets && wishlistPets.length > 0 && (
                    <>
                        <View style={styles.statDivider} />
                        <View style={styles.statBox}>
                            <Icon name="heart-outline" size={16} color="#FF6B6B" />
                            <Text style={styles.statLabel}>
                                {t('settings.portfolio.wishlist_value')}
                            </Text>
                            <Text style={styles.statValue}>
                                {formatValue(portfolio.wishlistTotal)}
                            </Text>
                        </View>
                        <View style={styles.statDivider} />
                        <View style={styles.statBox}>
                            <Icon name="trending-up-outline" size={16} color="#51CF66" />
                            <Text style={styles.statLabel}>
                                {t('settings.portfolio.wishlist_gap')}
                            </Text>
                            <Text style={[styles.statValue, { color: portfolio.wishlistGap > 0 ? '#FF6B6B' : '#51CF66' }]}>
                                {portfolio.wishlistGap > 0
                                    ? `-${formatValue(portfolio.wishlistGap)}`
                                    : '✓'}
                            </Text>
                        </View>
                    </>
                )}
            </View>
        </Animated.View>
    );
};

// ── Styles ─────────────────────────────────────────────
const getStyles = (isDarkMode) =>
    StyleSheet.create({
        container: {
            marginTop: 12,
            marginHorizontal: 0,
            paddingHorizontal: 10,
            paddingVertical: 14,
        },
        emptyContainer: {
            marginTop: 12,
            paddingVertical: 20,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
        },
        emptyText: {
            fontSize: 12,
            color: isDarkMode ? '#64748b' : '#9ca3af',
            textAlign: 'center',
        },

        // Header
        header: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
        },
        headerLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
        },
        headerTitle: {
            fontSize: 15,
            fontWeight: '700',
            color: isDarkMode ? '#f1f5f9' : '#111827',
        },
        itemCountBadge: {
            backgroundColor: isDarkMode ? '#1e293b' : '#f3f4f6',
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 12,
        },
        itemCountText: {
            fontSize: 11,
            fontWeight: '600',
            color: isDarkMode ? '#94a3b8' : '#6b7280',
        },

        // Total value card
        totalCard: {
            backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
            borderRadius: 14,
            padding: 16,
            alignItems: 'center',
            marginBottom: 14,
            borderWidth: 1,
            borderColor: isDarkMode ? '#334155' : '#e5e7eb',
            // Subtle shadow
            shadowColor: '#000',
            shadowOpacity: isDarkMode ? 0.2 : 0.06,
            shadowOffset: { width: 0, height: 2 },
            shadowRadius: 8,
            elevation: 3,
        },
        totalLabel: {
            fontSize: 11,
            fontWeight: '600',
            color: isDarkMode ? '#94a3b8' : '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 4,
        },
        totalValue: {
            fontSize: 32,
            fontWeight: '800',
            color: config.colors.primary,
            letterSpacing: -0.5,
        },
        avgRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 6,
        },
        avgText: {
            fontSize: 11,
            color: isDarkMode ? '#94a3b8' : '#6b7280',
        },

        // Sections
        section: {
            marginBottom: 14,
        },
        sectionTitle: {
            fontSize: 13,
            fontWeight: '700',
            color: isDarkMode ? '#e5e7eb' : '#111827',
            marginBottom: 10,
        },

        // Top items
        topItemRow: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
            borderRadius: 10,
            padding: 10,
            marginBottom: 6,
            borderWidth: 1,
            borderColor: isDarkMode ? '#334155' : '#f3f4f6',
        },
        topItemRank: {
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: isDarkMode ? '#334155' : '#f3f4f6',
            justifyContent: 'center',
            alignItems: 'center',
            marginRight: 8,
        },
        rankText: {
            fontSize: 10,
            fontWeight: '800',
            color: isDarkMode ? '#94a3b8' : '#6b7280',
        },
        topItemImage: {
            width: 36,
            height: 36,
            borderRadius: 8,
            marginRight: 10,
            backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
        },
        topItemInfo: {
            flex: 1,
        },
        topItemName: {
            fontSize: 13,
            fontWeight: '600',
            color: isDarkMode ? '#f1f5f9' : '#111827',
        },
        topItemCategory: {
            fontSize: 10,
            fontWeight: '500',
            marginTop: 2,
        },
        topItemValue: {
            fontSize: 14,
            fontWeight: '700',
            color: config.colors.primary,
        },

        // Category breakdown
        categoryBarContainer: {
            flexDirection: 'row',
            height: 8,
            borderRadius: 6,
            overflow: 'hidden',
            marginBottom: 10,
        },
        categoryBarSegment: {
            height: '100%',
        },
        categoryLegend: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 4,
        },
        legendItem: {
            flexDirection: 'row',
            alignItems: 'center',
            marginRight: 12,
            marginBottom: 4,
        },
        legendDot: {
            width: 8,
            height: 8,
            borderRadius: 4,
            marginRight: 4,
        },
        legendText: {
            fontSize: 11,
            fontWeight: '500',
            color: isDarkMode ? '#94a3b8' : '#6b7280',
            marginRight: 3,
        },
        legendValue: {
            fontSize: 10,
            fontWeight: '600',
            color: isDarkMode ? '#64748b' : '#9ca3af',
        },

        // Stats row
        statsRow: {
            flexDirection: 'row',
            backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
            borderRadius: 12,
            padding: 12,
            borderWidth: 1,
            borderColor: isDarkMode ? '#334155' : '#e5e7eb',
        },
        statBox: {
            flex: 1,
            alignItems: 'center',
            gap: 4,
        },
        statLabel: {
            fontSize: 9,
            fontWeight: '600',
            color: isDarkMode ? '#64748b' : '#9ca3af',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            textAlign: 'center',
        },
        statValue: {
            fontSize: 13,
            fontWeight: '700',
            color: isDarkMode ? '#f1f5f9' : '#111827',
            textAlign: 'center',
        },
        statDivider: {
            width: 1,
            backgroundColor: isDarkMode ? '#334155' : '#e5e7eb',
            marginHorizontal: 4,
        },
    });

export default React.memo(PortfolioValuation);
