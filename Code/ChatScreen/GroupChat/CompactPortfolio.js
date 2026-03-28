import React, { useMemo, useState } from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import {
    View,
    Text,
    Image,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    LayoutAnimation,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';

// ── Value Formatter ────────────────────────────────────
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
    pets: '#FF6B6B', eggs: '#FFA94D', vehicles: '#51CF66',
    toys: '#845EF7', 'pet wear': '#339AF0', food: '#20C997',
    strollers: '#F06595', gifts: '#FF922B', other: '#868E96',
};
const getCategoryColor = (cat) =>
    cat ? CATEGORY_COLORS[cat.toLowerCase()] || '#868E96' : '#868E96';

// ════════════════════════════════════════════════════════
// ── CompactPortfolio ───────────────────────────────────
// Collapsed: summary row + mini category bar
// Expanded:  full pet lists (owned + wishlist) + valuation
// ════════════════════════════════════════════════════════
const CompactPortfolio = ({
    ownedPets = [],
    wishlistPets = [],
    isDarkMode,
    t,
    loadingPets,
    renderPetBubble,
    lookupPetValue,
}) => {
    const [expanded, setExpanded] = useState(false);
    const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

    const portfolio = useMemo(() => {
        if (!ownedPets || ownedPets.length === 0) return null;

        const getVal = (p) => lookupPetValue ? lookupPetValue(p) : (Number(p.value) || 0);
        const totalValue = ownedPets.reduce((s, p) => s + getVal(p), 0);
        const totalItems = ownedPets.length;
        const avgValue = totalItems > 0 ? totalValue / totalItems : 0;

        const catMap = {};
        ownedPets.forEach((p) => {
            const c = (p.category || 'Other').toLowerCase();
            if (!catMap[c]) catMap[c] = { value: 0, count: 0 };
            catMap[c].value += getVal(p);
            catMap[c].count += 1;
        });

        const categories = Object.entries(catMap)
            .map(([name, d]) => ({
                name, value: d.value, count: d.count,
                pct: totalValue > 0 ? (d.value / totalValue) * 100 : 0,
                color: getCategoryColor(name),
            }))
            .sort((a, b) => b.value - a.value);

        const wishVal = (wishlistPets || []).reduce(
            (s, p) => s + (lookupPetValue ? lookupPetValue(p) : (Number(p.value) || 0)), 0,
        );

        return { totalValue, totalItems, avgValue, categories, wishVal };
    }, [ownedPets, wishlistPets, lookupPetValue]);

    const toggleExpand = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((prev) => !prev);
    };

    // ── Loading state ──────────────────────────────────
    if (loadingPets) {
        return (
            <View style={styles.wrap}>
                <ActivityIndicator size="small" color={config.colors.primary} />
            </View>
        );
    }

    // ── Empty state (no owned pets) ────────────────────
    if (!portfolio) {
        return (
            <View style={styles.wrap}>
                <View style={styles.emptyRow}>
                    <Icon name="paw-outline" size={16} color={isDarkMode ? '#475569' : '#d1d5db'} />
                    <Text style={styles.emptyText}>
                        {t('profile.no_pets_listed')}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.wrap}>
            {/* ═══════ COLLAPSED SUMMARY ═══════ */}
            <TouchableOpacity
                activeOpacity={0.7}
                onPress={toggleExpand}
                style={styles.summaryRow}
            >
                <View style={styles.summaryLeft}>
                    <View style={{
                        width: 24, height: 24, borderRadius: 8,
                        backgroundColor: isDarkMode ? 'rgba(236,72,153,0.15)' : 'rgba(236,72,153,0.1)',
                        alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Icon name="diamond" size={12} color="#ec4899" />
                    </View>
                    <Text style={styles.summaryTitle}>
                        {t('settings.portfolio.title')}
                    </Text>
                </View>
                <View style={styles.summaryRight}>
                    <Text style={styles.summaryValue}>
                        {formatValue(portfolio.totalValue)}
                    </Text>
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                            {portfolio.totalItems} {t('settings.portfolio.items')}
                        </Text>
                    </View>
                    <Icon
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={isDarkMode ? '#64748b' : '#9ca3af'}
                    />
                </View>
            </TouchableOpacity>

            {/* Mini category bar (always visible) */}
            {portfolio.categories.length > 0 && (
                <View style={styles.miniBar}>
                    {portfolio.categories.map((c, i) => (
                        <View
                            key={c.name}
                            style={{
                                flex: c.pct,
                                height: '100%',
                                backgroundColor: c.color,
                                borderTopLeftRadius: i === 0 ? 3 : 0,
                                borderBottomLeftRadius: i === 0 ? 3 : 0,
                                borderTopRightRadius: i === portfolio.categories.length - 1 ? 3 : 0,
                                borderBottomRightRadius: i === portfolio.categories.length - 1 ? 3 : 0,
                            }}
                        />
                    ))}
                </View>
            )}

            {/* ═══════ EXPANDED DETAILS ═══════ */}
            {expanded && (
                <View style={styles.expandedArea}>

                    {/* ── Owned Pets (full list) ── */}
                    <View style={styles.petSection}>
                        <Text style={styles.petSectionLabel}>
                            {t('profile.pets.owned_title')}
                        </Text>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{ paddingRight: 6 }}
                        >
                            <View style={{ flexDirection: 'row' }}>
                                {ownedPets.map((pet, index) =>
                                    renderPetBubble(pet, index),
                                )}
                            </View>
                        </ScrollView>
                    </View>

                    {/* ── Wishlist (full list) ── */}
                    <View style={styles.petSection}>
                        <Text style={styles.petSectionLabel}>
                            {t('profile.pets.wishlist_title')}
                        </Text>
                        {wishlistPets.length === 0 ? (
                            <Text style={styles.petEmpty}>
                                {t('profile.no_wishlist_pets')}
                            </Text>
                        ) : (
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ paddingRight: 6 }}
                            >
                                <View style={{ flexDirection: 'row' }}>
                                    {wishlistPets.map((pet, index) =>
                                        renderPetBubble(pet, index),
                                    )}
                                </View>
                            </ScrollView>
                        )}
                    </View>

                    {/* ── Valuation card ── */}
                    <View style={styles.valCard}>
                        <View>
                            <Text style={styles.valLabel}>
                                {t('settings.portfolio.total_value')}
                            </Text>
                            <Text style={styles.valNum}>
                                {formatValue(portfolio.totalValue)}
                            </Text>
                        </View>
                    </View>

                    {/* ── Category legends ── */}
                    {portfolio.categories.length > 0 && (
                        <View style={styles.catLegend}>
                            {portfolio.categories.map((c) => (
                                <View key={c.name} style={styles.legendItem}>
                                    <View style={[styles.legendDot, { backgroundColor: c.color }]} />
                                    <Text style={styles.legendLabel}>
                                        {c.name.charAt(0).toUpperCase() + c.name.slice(1)}
                                    </Text>
                                    <Text style={styles.legendPct}>
                                        {formatValue(c.value)} ({Math.round(c.pct)}%)
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* ── Wishlist comparison ── */}
                    {wishlistPets && wishlistPets.length > 0 && (
                        <View style={styles.wishRow}>
                            <View style={styles.wishItem}>
                                <Icon name="heart-outline" size={12} color="#FF6B6B" />
                                <Text style={styles.wishLabel}>{t('settings.portfolio.wishlist_value')}</Text>
                                <Text style={styles.wishVal}>{formatValue(portfolio.wishVal)}</Text>
                            </View>
                            <View style={styles.wishDivider} />
                            <View style={styles.wishItem}>
                                <Icon name="trending-up-outline" size={12} color="#51CF66" />
                                <Text style={styles.wishLabel}>{t('settings.portfolio.wishlist_gap')}</Text>
                                <Text style={[styles.wishVal, {
                                    color: portfolio.wishVal > portfolio.totalValue ? '#FF6B6B' : '#51CF66',
                                }]}>
                                    {portfolio.wishVal > portfolio.totalValue
                                        ? `-${formatValue(portfolio.wishVal - portfolio.totalValue)}`
                                        : '✓'}
                                </Text>
                            </View>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
};

// ── Styles ─────────────────────────────────────────────
const getStyles = (dark) =>
    StyleSheet.create({
        wrap: {
            backgroundColor: dark ? '#1e293b' : '#f8fafc',
            borderRadius: 14,
            padding: 12,
            marginBottom: 8,
        },

        /* empty */
        emptyRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: 4,
        },
        emptyText: {
            fontSize: 11,
            color: dark ? '#9ca3af' : '#6b7280',
        },

        /* summary row */
        summaryRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        summaryLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
        summaryTitle: {
            fontSize: 12,
            fontWeight: '700',
            color: dark ? '#e5e7eb' : '#111827',
        },
        summaryRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        summaryValue: {
            fontSize: 14,
            fontWeight: '800',
            color: config.colors.primary,
        },
        badge: {
            backgroundColor: dark ? '#0f172a' : '#e5e7eb',
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 6,
        },
        badgeText: {
            fontSize: 8,
            fontWeight: '600',
            color: dark ? '#94a3b8' : '#6b7280',
        },

        /* mini bar */
        miniBar: {
            flexDirection: 'row',
            height: 4,
            borderRadius: 3,
            overflow: 'hidden',
            marginTop: 8,
        },

        /* expanded */
        expandedArea: { marginTop: 12 },

        /* pet sections */
        petSection: { marginBottom: 10 },
        petSectionLabel: {
            fontSize: 11,
            fontWeight: '600',
            color: dark ? '#94a3b8' : '#6b7280',
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
        },
        petEmpty: {
            fontSize: 11,
            color: dark ? '#64748b' : '#9ca3af',
        },

        /* valuation card */
        valCard: {
            backgroundColor: dark ? '#111827' : '#ffffff',
            borderRadius: 10,
            padding: 10,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: dark ? '#334155' : '#f3f4f6',
        },
        valCardRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
        },
        valLabel: {
            fontSize: 9,
            fontWeight: '600',
            color: dark ? '#64748b' : '#9ca3af',
            textTransform: 'uppercase',
            letterSpacing: 0.6,
        },
        valNum: {
            fontSize: 22,
            fontWeight: '800',
            color: config.colors.primary,
            letterSpacing: -0.5,
            marginTop: 1,
        },
        avgBox: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 3,
            backgroundColor: dark ? '#0f172a' : '#f3f4f6',
            paddingHorizontal: 8,
            paddingVertical: 5,
            borderRadius: 8,
        },
        avgText: {
            fontSize: 9,
            color: dark ? '#64748b' : '#9ca3af',
            fontWeight: '600',
            lineHeight: 13,
        },

        /* category legends */
        catLegend: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 2,
            marginBottom: 8,
        },
        legendItem: {
            flexDirection: 'row',
            alignItems: 'center',
            marginRight: 8,
            marginBottom: 2,
        },
        legendDot: { width: 6, height: 6, borderRadius: 3, marginRight: 3 },
        legendLabel: {
            fontSize: 9,
            fontWeight: '500',
            color: dark ? '#94a3b8' : '#6b7280',
            marginRight: 2,
        },
        legendPct: {
            fontSize: 8,
            fontWeight: '700',
            color: dark ? '#475569' : '#9ca3af',
        },

        /* wishlist row */
        wishRow: {
            flexDirection: 'row',
            backgroundColor: dark ? '#111827' : '#ffffff',
            borderRadius: 8,
            padding: 8,
            borderWidth: 1,
            borderColor: dark ? '#334155' : '#f3f4f6',
        },
        wishItem: { flex: 1, alignItems: 'center', gap: 2 },
        wishLabel: {
            fontSize: 8,
            fontWeight: '600',
            color: dark ? '#475569' : '#9ca3af',
            textTransform: 'uppercase',
        },
        wishVal: {
            fontSize: 12,
            fontWeight: '700',
            color: dark ? '#e5e7eb' : '#111827',
        },
        wishDivider: {
            width: 1,
            backgroundColor: dark ? '#334155' : '#e5e7eb',
            marginHorizontal: 4,
        },
    });

export default React.memo(CompactPortfolio);
