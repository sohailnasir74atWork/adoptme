// OfferWall.jsx — Full-Screen, Kid-Friendly, Convincing Pro Paywall
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  StyleSheet, StatusBar, Platform, ActivityIndicator,
  Dimensions, Linking, Animated, Easing, ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import SafeLottieView from '../Helper/SafeLottieView';
import { useLocalState } from '../LocalGlobelStats';
import { mixpanel } from '../AppHelper/MixPenel';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import SystemNavigationBar from 'react-native-system-navigation-bar';

const { width, height } = Dimensions.get('window');

// ── Compelling Benefits — app-specific value props ──
const BENEFITS = [
  {
    icon: 'rocket',
    label: 'Featured Trades',
    desc: 'Your trades appear at the TOP for everyone!',
    color: '#FF6B6B',
    tag: 'HOT',
  },
  {
    icon: 'ban-outline',
    label: 'No Ads Ever',
    desc: 'Zero ads, zero interruptions. Clean experience',
    color: '#4ECDC4',
    tag: 'NEW',
  },
  {
    icon: 'stats-chart',
    label: 'Full Analytics',
    desc: 'Top movers, losers, most wanted & offered pets',
    color: '#7C6FFF',
  },
  {
    icon: 'star',
    label: 'Exclusive PRO Badge',
    desc: 'Stand out with a PRO badge on your profile',
    color: '#FFD93D',
  },
  {
    icon: 'language',
    label: 'Unlimited Translations',
    desc: 'Chat with anyone in any language, no limits',
    color: '#F472B6',
  },
  {
    icon: 'color-palette',
    label: 'Exclusive Cosmetics',
    desc: 'Unlock extra cosmetic slots & exclusive items',
    color: '#A78BFA',
  },
  {
    icon: 'shield-checkmark',
    label: 'Scam Protection',
    desc: 'Get alerts when trading with flagged users',
    color: '#34D399',
  },
];

const CLOSE_TIMER_SECONDS = 7;

const SubscriptionScreen = ({ visible, onClose, track, showoffer, oneWallOnly, inline }) => {
  const { packages, purchaseProduct, restorePurchases, localState } = useLocalState();
  const { theme } = useGlobalState();

  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [closeTimer, setCloseTimer] = useState(CLOSE_TIMER_SECONDS);
  const canClose = closeTimer <= 0;
  const isDark = theme === 'dark';

  // Theme colors
  const c = {
    bg: isDark ? '#0B0420' : '#F8F7FF',
    bgAlt: isDark ? '#130830' : '#EEEAFF',
    text: isDark ? '#fff' : '#1a1a2e',
    textSub: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)',
    textMuted: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
    cardBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    cardBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    closeBtn: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    closeIcon: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)',
    timerBorder: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
    timerColor: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)',
    benefitLabel: isDark ? '#F1F0FF' : '#1a1a2e',
    pkgBorder: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)',
    pkgBg: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(124,111,255,0.04)',
    pkgLabel: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
    pkgPrice: isDark ? '#F1F0FF' : '#1a1a2e',
    fixedBg: isDark ? '#0B0420' : '#F8F7FF',
    fixedBorder: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    footerLink: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)',
    footerMuted: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
    footerDot: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
    statusBar: isDark ? 'light-content' : 'dark-content',
  };

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(60)).current;
  const closeFade = useRef(new Animated.Value(0)).current;
  const benefitAnims = useRef(BENEFITS.map(() => new Animated.Value(0))).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  // ── Close button countdown ──
  useEffect(() => {
    if (!visible) return;
    setCloseTimer(CLOSE_TIMER_SECONDS);
    const interval = setInterval(() => {
      setCloseTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          Animated.timing(closeFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  // ── Set system nav bar on Android ──
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (visible) {
      const owBg = isDark ? '#0B0420' : '#F8F7FF';
      SystemNavigationBar.setNavigationColor(owBg, isDark ? 'light' : 'dark');
    } else {
      const bg = isDark ? '#0f172a' : '#ffffff';
      SystemNavigationBar.setNavigationColor(bg, isDark ? 'light' : 'dark');
    }
  }, [visible, isDark]);

  // ── Entrance animation ──
  useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(60);
      benefitAnims.forEach(a => a.setValue(0));

      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 600, easing: Easing.out(Easing.back(1.2)), useNativeDriver: true }),
      ]).start();

      // Stagger benefits
      Animated.stagger(80,
        benefitAnims.map(anim =>
          Animated.spring(anim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true })
        )
      ).start();
    }
  }, [visible]);

  // ── CTA pulse ──
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // ── Shimmer for "BEST VALUE" tag ──
  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerAnim, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true })
    ).start();
  }, []);

  // Auto-select best package
  useEffect(() => {
    if (visible && packages?.length > 0 && !selectedPkg) {
      const annual = packages.find(p => p.packageType === 'ANNUAL');
      const monthly = packages.find(p => p.packageType === 'MONTHLY');
      setSelectedPkg(annual || monthly || packages[0]);
    }
  }, [visible, packages]);

  // Reset on close
  useEffect(() => {
    if (!visible) {
      setSelectedPkg(null);
      setLoading(false);
    }
  }, [visible]);

  // Track shown
  useEffect(() => {
    if (visible) {
      mixpanel.track('custom_paywall_presented', { source: track || 'unknown' });
    }
  }, [visible]);

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg || loading) return;
    mixpanel.track('custom_paywall_purchase_tap', {
      source: track || 'unknown',
      package: selectedPkg.identifier,
      price: selectedPkg.product?.price,
    });
    await purchaseProduct(selectedPkg, setLoading, track);
    setTimeout(() => {
      if (localState?.isPro) {
        mixpanel.track('custom_paywall_purchase_success', {
          source: track || 'unknown',
          package: selectedPkg.identifier,
        });
        onClose?.();
      }
    }, 500);
  }, [selectedPkg, loading, purchaseProduct, track, localState?.isPro, onClose]);

  const handleRestore = useCallback(async () => {
    if (restoring) return;
    await restorePurchases(setRestoring);
    setTimeout(() => {
      if (localState?.isPro) onClose?.();
    }, 500);
  }, [restoring, restorePurchases, localState?.isPro, onClose]);

  const getPkgMeta = (pkg) => {
    const t = pkg.packageType;
    if (t === 'WEEKLY') return { label: 'Weekly', emoji: '⚡', color: '#4ECDC4', accent: '#2AB5AB' };
    if (t === 'MONTHLY') return { label: 'Monthly', emoji: '🌟', color: '#A78BFA', accent: '#8B6FE8' };
    if (t === 'ANNUAL') return { label: 'Yearly', emoji: '👑', color: '#FFD93D', accent: '#F5C518' };
    if (t === 'SIX_MONTH') return { label: '6 Months', emoji: '🔥', color: '#FF6B6B', accent: '#E85555' };
    if (t === 'THREE_MONTH') return { label: '3 Months', emoji: '💎', color: '#F472B6', accent: '#E25DA0' };
    return { label: pkg.identifier || 'Plan', emoji: '✨', color: '#7C6FFF', accent: '#6A5FE0' };
  };

  const getLabel = (pkg) => getPkgMeta(pkg).label;

  const isBest = (pkg) => pkg.packageType === 'ANNUAL';

  const getSavings = (pkg) => {
    if (pkg.packageType !== 'ANNUAL' || packages.length < 2) return null;
    const monthly = packages.find(p => p.packageType === 'MONTHLY');
    if (!monthly) return null;
    const yearlyTotal = pkg.product?.price || 0;
    const monthlyTotal = (monthly.product?.price || 0) * 12;
    if (monthlyTotal <= 0 || yearlyTotal >= monthlyTotal) return null;
    const saved = Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100);
    return saved > 0 ? saved : null;
  };

  // Generate "double value" strikethrough price (2× actual)
  const getStrikethroughPrice = (pkg) => {
    const price = pkg.product?.price;
    if (!price) return null;
    const doublePrice = price * 2;
    const currencyCode = pkg.product?.currencyCode || '';
    // Format with same currency symbol
    const priceStr = pkg.product?.priceString || '';
    // Extract currency symbol from priceString
    const symbol = priceStr.replace(/[\d.,\s]/g, '').trim();
    if (Number.isInteger(doublePrice)) {
      return `${symbol}${doublePrice}`;
    }
    return `${symbol}${doublePrice.toFixed(2)}`;
  };

  const content = (
      <View style={[s.container, { backgroundColor: c.bg }]}>
        <StatusBar barStyle={c.statusBar} backgroundColor={c.bg} />

        {/* ── Background gradient ── */}
        <View style={s.bgGradient}>
          <View style={[s.bgTop, { backgroundColor: c.bg }]} />
          <View style={[s.bgBottom, { backgroundColor: c.bgAlt }]} />
        </View>

        {/* ── Sparkle overlay ── */}
        <SafeLottieView
          source={require('../../assets/lottie/sparkle.json')}
          autoPlay
          loop
          resizeMode="cover"
          style={s.sparkleOverlay}
          imageAssetsFolder=""
          renderMode={Platform.OS === 'android' ? 'SOFTWARE' : 'HARDWARE'}
          cacheComposition={false}
        />

        {/* ── Close / Timer ── */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }} />
          {canClose ? (
            <Animated.View style={{ opacity: closeFade }}>
              <TouchableOpacity onPress={onClose} style={[s.closeBtn, { backgroundColor: c.closeBtn }]} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={18} color={c.closeIcon} />
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <View style={[s.timerBadge, { borderColor: c.timerBorder }]}>
              <Text style={[s.timerText, { color: c.timerColor }]}>{closeTimer}</Text>
            </View>
          )}
        </View>

        {/* ── SCROLLABLE BODY ── */}
        <ScrollView
          style={s.scrollBody}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={true}
        >
          {/* ── Hero: Dancing Cat + Title ── */}
          <Animated.View style={[s.heroSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <View style={s.catContainer}>
              <SafeLottieView
                source={require('../../assets/Dance cat.json')}
                autoPlay
                loop
                resizeMode="contain"
                style={s.dancingCat}
                renderMode={Platform.OS === 'android' ? 'SOFTWARE' : 'HARDWARE'}
                cacheComposition={false}
              />
            </View>
            <Text style={[s.heroTitle, { color: c.text }]}>Go PRO! ✨</Text>
            <Text style={[s.heroSub, { color: c.textSub }]}>Get the BEST trades & coolest perks!</Text>

            {/* Limited time badge */}
            <View style={[s.limitedBadge, { backgroundColor: isDark ? 'rgba(255,217,61,0.12)' : 'rgba(200,150,0,0.12)', borderColor: isDark ? 'rgba(255,217,61,0.3)' : 'rgba(200,150,0,0.3)' }]}>
              <Icon name="time-outline" size={13} color={isDark ? '#FFD93D' : '#B8860B'} />
              <Text style={[s.limitedText, { color: isDark ? '#FFD93D' : '#8B6914' }]}>🔥 50% OFF — Limited Time!</Text>
            </View>
          </Animated.View>

          {/* ── Benefits List ── */}
          <View style={s.benefitsList}>
            {BENEFITS.map((b, i) => (
              <Animated.View
                key={i}
                style={[
                  s.benefitRow,
                  { backgroundColor: c.cardBg, borderColor: c.cardBorder },
                  {
                    opacity: benefitAnims[i],
                    transform: [{
                      translateX: benefitAnims[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [-30, 0],
                      })
                    }],
                  }
                ]}
              >
                <View style={[s.benefitIconCircle, { backgroundColor: b.color + '25' }]}>
                  <Icon name={b.icon} size={16} color={b.color} />
                </View>
                <View style={s.benefitTextWrap}>
                  <View style={s.benefitLabelRow}>
                    <Text style={[s.benefitLabel, { color: c.benefitLabel }]}>{b.label}</Text>
                    {b.tag && (
                      <View style={[s.benefitTag, { backgroundColor: b.tag === 'HOT' ? '#FF6B6B' : '#4ECDC4' }]}>
                        <Text style={s.benefitTagText}>{b.tag}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[s.benefitDesc, { color: c.textMuted }]}>{b.desc}</Text>
                </View>
                <View style={s.checkCircle}>
                  <Icon name="checkmark" size={12} color="#fff" />
                </View>
              </Animated.View>
            ))}
          </View>
        </ScrollView>

        {/* ── FIXED BOTTOM: Packages + CTA + Footer ── */}
        <View style={[s.fixedBottom, { backgroundColor: c.fixedBg, borderTopColor: c.fixedBorder }]}>
          {/* Package Cards */}
          {packages?.length > 0 ? (
            <View style={s.pkgRow}>
              {packages.map((pkg, i) => {
                const isSelected = selectedPkg?.identifier === pkg.identifier;
                const best = isBest(pkg);
                const savings = getSavings(pkg);
                const strikePrice = getStrikethroughPrice(pkg);
                const meta = getPkgMeta(pkg);
                return (
                  <TouchableOpacity
                    key={pkg.identifier || i}
                    style={[
                      s.pkgCard,
                      { borderColor: isSelected ? meta.color : c.pkgBorder, backgroundColor: isSelected ? meta.color + '18' : c.pkgBg },
                      isSelected && { shadowColor: meta.color, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
                    ]}
                    onPress={() => setSelectedPkg(pkg)}
                    activeOpacity={0.8}
                  >
                    {best && (
                      <View style={[s.bestTag, { backgroundColor: meta.color }]}> 
                        <Text style={s.bestTagText}>👑 BEST VALUE</Text>
                      </View>
                    )}
                    <Text style={s.pkgEmoji}>{meta.emoji}</Text>
                    <Text style={[s.pkgLabel, { color: isSelected ? meta.color : c.pkgLabel }]}>{meta.label}</Text>
                    <View style={s.pkgPriceRow}>
                      {strikePrice && (
                        <Text style={s.strikePrice}>{strikePrice}</Text>
                      )}
                    </View>
                    <Text style={[s.pkgPrice, isSelected && { color: '#fff' }, { color: c.pkgPrice }]}>
                      {pkg.product?.priceString || '...'}
                    </Text>
                    {savings ? (
                      <View style={[s.savingsBadge, { backgroundColor: meta.color + '25' }]}>
                        <Text style={[s.savingsText, { color: meta.color }]}>🎉 {savings}% OFF</Text>
                      </View>
                    ) : (
                      <View style={s.pkgSpacer} />
                    )}
                    {isSelected && (
                      <View style={[s.pkgCheck, { backgroundColor: meta.color }]}>
                        <Icon name="checkmark" size={10} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="small" color="#A78BFA" />
              <Text style={s.loadingText}>Loading plans...</Text>
            </View>
          )}

          {/* CTA Button */}
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              style={[s.ctaBtn, loading && { opacity: 0.7 }]}
              onPress={handlePurchase}
              disabled={loading || !selectedPkg}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <View style={s.ctaInner}>
                  <Icon name="sparkles" size={20} color="#FFD93D" style={{ marginRight: 8 }} />
                  <Text style={s.ctaText}>Be a Pro Now!</Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* Compact footer — single line */}
          <View style={s.footerRow}>
            <TouchableOpacity onPress={handleRestore} disabled={restoring}>
              {restoring ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : (
                <Text style={[s.footerLink, { color: c.footerLink }]}>Restore</Text>
              )}
            </TouchableOpacity>
            <Text style={[s.footerDot, { color: c.footerDot }]}>·</Text>
            <Text style={[s.footerMuted, { color: c.footerMuted }]}>Auto-renews</Text>
            <Text style={[s.footerDot, { color: c.footerDot }]}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://adoptmevalues.app/privacy')}>
              <Text style={[s.footerLink, { color: c.footerLink }]}>Privacy</Text>
            </TouchableOpacity>
            <Text style={[s.footerDot, { color: c.footerDot }]}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL('https://adoptmevalues.app/terms')}>
              <Text style={[s.footerLink, { color: c.footerLink }]}>Terms</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
  );

  // ── Inline mode: render as plain view (no modal) ──
  if (inline) {
    return content;
  }

  // ── Default: render inside a Modal ──
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? onClose : undefined}>
      {content}
    </Modal>
  );
};

// ── Styles ──
const BOTTOM_SAFE = Platform.OS === 'ios' ? 28 : 12;

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0420',
  },

  // Background
  bgGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  bgTop: {
    flex: 1,
    backgroundColor: '#0B0420',
  },
  bgBottom: {
    flex: 1,
    backgroundColor: '#130830',
  },

  // Sparkle overlay
  sparkleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: height * 0.45,
    opacity: 0.25,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : (StatusBar.currentHeight || 24) + 4,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '800',
  },

  // Scrollable body
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Platform.OS === 'ios' ? 60 : (StatusBar.currentHeight || 24) + 30,
    paddingBottom: 6,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  catContainer: {
    width: 120,
    height: 120,
    marginBottom: 2,
  },
  dancingCat: {
    width: '100%',
    height: '100%',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    fontWeight: '500',
    marginTop: 2,
    textAlign: 'center',
  },
  limitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,217,61,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,217,61,0.3)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    marginTop: 8,
    gap: 4,
  },
  limitedText: {
    color: '#FFD93D',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Benefits
  benefitsList: {
    paddingHorizontal: 16,
    marginTop: 8,
    gap: 4,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  benefitIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  benefitTextWrap: {
    flex: 1,
  },
  benefitLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  benefitLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F1F0FF',
  },
  benefitTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
  },
  benefitTagText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  benefitDesc: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '500',
    marginTop: 1,
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#34D399',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },

  // Fixed bottom
  fixedBottom: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: BOTTOM_SAFE,
    backgroundColor: '#0B0420',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },

  // Packages — Kid-Friendly Vibrant Design
  pkgRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  pkgCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    position: 'relative',
    overflow: 'visible',
  },
  bestTag: {
    position: 'absolute',
    top: -10,
    backgroundColor: '#FFD93D',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    zIndex: 1,
    shadowColor: '#FFD93D',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  bestTagText: {
    color: '#1a0a00',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  pkgEmoji: {
    fontSize: 24,
    marginBottom: 2,
  },
  pkgLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pkgPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  strikePrice: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,100,100,0.6)',
    textDecorationLine: 'line-through',
    textDecorationStyle: 'solid',
  },
  pkgPrice: {
    fontSize: 18,
    fontWeight: '900',
    color: '#F1F0FF',
    marginTop: 2,
  },
  savingsBadge: {
    backgroundColor: 'rgba(52,211,153,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
  },
  savingsText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  pkgSpacer: {
    height: 20,
  },
  pkgCheck: {
    position: 'absolute',
    bottom: -7,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },

  // Loading
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  loadingText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 6,
  },

  // CTA
  ctaBtn: {
    backgroundColor: '#7C6FFF',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#7C6FFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ctaText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.3,
  },

  // Footer — compact single line
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 4,
    flexWrap: 'wrap',
  },
  footerLink: {
    fontSize: 10,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.35)',
    textDecorationLine: 'underline',
  },
  footerMuted: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
  },
  footerDot: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.15)',
  },
});

export default SubscriptionScreen;
