// OfferWall.jsx — Adopt Me Values PRO paywall
// Goals: premium look, one obvious choice, kid-readable copy, honest pricing.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  StyleSheet, StatusBar, Platform, ActivityIndicator,
  Dimensions, Linking, Animated, Easing, ScrollView,
} from 'react-native';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Rect } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import SafeLottieView from '../Helper/SafeLottieView';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { mixpanel } from '../AppHelper/MixPenel';
import { useGlobalState } from '../GlobelStats';
import SystemNavigationBar from 'react-native-system-navigation-bar';

const { height } = Dimensions.get('window');
const SMALL_SCREEN = height < 700;

// ── Brand ──
const BRAND = '#7C6FFF';
const HERO_GRADIENT = ['#8B7BFF', '#6C4DE0', '#4B2FB5'];

// ── The three benefits that actually sell PRO ──
const HERO_BENEFITS = [
  { icon: 'rocket', color: '#FF6B6B', titleKey: 'featured_title', descKey: 'featured_desc' },
  { icon: 'ban', color: '#4ECDC4', titleKey: 'noads_title', descKey: 'noads_desc' },
  { icon: 'star', color: '#FFB703', titleKey: 'badge_title', descKey: 'badge_desc' },
];

// ── Secondary perks, shown as compact chips ──
const PERK_CHIPS = [
  { icon: 'stats-chart', color: '#7C6FFF', labelKey: 'chip_analytics' },
  { icon: 'language', color: '#F472B6', labelKey: 'chip_translate' },
  { icon: 'color-palette', color: '#A78BFA', labelKey: 'chip_cosmetics' },
  { icon: 'shield-checkmark', color: '#34D399', labelKey: 'chip_safety' },
];

const CLOSE_TIMER_SECONDS = 5;

// Ordering: longest plan first, so the best value is the first thing read.
const PLAN_ORDER = {
  LIFETIME: 0, ANNUAL: 1, SIX_MONTH: 2, THREE_MONTH: 3, TWO_MONTH: 4, MONTHLY: 5, WEEKLY: 6,
};
// Average weeks per billing period — used to compare plans on a common scale.
const WEEKS_IN_PERIOD = {
  WEEKLY: 1, MONTHLY: 4.345, TWO_MONTH: 8.69, THREE_MONTH: 13.043, SIX_MONTH: 26.086, ANNUAL: 52.143,
};
const PLAN_KEY = {
  WEEKLY: 'plan_weekly', MONTHLY: 'plan_monthly', TWO_MONTH: 'plan_two_month',
  THREE_MONTH: 'plan_three_month', SIX_MONTH: 'plan_six_month', ANNUAL: 'plan_annual',
  LIFETIME: 'plan_lifetime',
};
const PERIOD_KEY = {
  WEEKLY: 'period_week', MONTHLY: 'period_month', TWO_MONTH: 'period_2months',
  THREE_MONTH: 'period_3months', SIX_MONTH: 'period_6months', ANNUAL: 'period_year',
};
const PLAN_EMOJI = {
  WEEKLY: '⚡', MONTHLY: '🌟', TWO_MONTH: '🔥', THREE_MONTH: '💎',
  SIX_MONTH: '🔥', ANNUAL: '👑', LIFETIME: '🏆',
};

// Rebuild a price string at a different amount, keeping the store's currency
// symbol and its position (prefix "$4.99" vs suffix "4,99 €").
const formatMoney = (pkg, amount) => {
  const currency = pkg?.product?.currencyCode;
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
    } catch (e) {
      // Fall through to the manual formatter below
    }
  }
  const priceString = pkg?.product?.priceString || '';
  const symbol = priceString.replace(/[\d\s.,]/g, '').trim();
  const value = amount.toFixed(2);
  if (!symbol) return value;
  const firstDigit = priceString.search(/\d/);
  const symbolIndex = priceString.indexOf(symbol[0]);
  return (firstDigit !== -1 && symbolIndex > firstDigit) ? `${value} ${symbol}` : `${symbol}${value}`;
};

const SubscriptionScreen = ({ visible, onClose, track, showoffer, oneWallOnly, inline }) => {
  const { packages, purchaseProduct, restorePurchases, localState } = useLocalState();
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [closeTimer, setCloseTimer] = useState(CLOSE_TIMER_SECONDS);
  const canClose = closeTimer <= 0;
  const isDark = theme === 'dark';

  // Theme colors — the hero is always dark-on-gradient, so only the body flips.
  const c = {
    bg: isDark ? '#0B0420' : '#F7F6FF',
    text: isDark ? '#F1F0FF' : '#171630',
    textSub: isDark ? 'rgba(255,255,255,0.62)' : 'rgba(23,22,48,0.58)',
    textMuted: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(23,22,48,0.45)',
    cardBg: isDark ? 'rgba(255,255,255,0.055)' : '#FFFFFF',
    cardBorder: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(23,22,48,0.07)',
    chipBg: isDark ? 'rgba(255,255,255,0.045)' : 'rgba(124,111,255,0.07)',
    closeBtn: 'rgba(0,0,0,0.32)',
    planBg: isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF',
    planBorder: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(23,22,48,0.1)',
    planBgActive: isDark ? 'rgba(124,111,255,0.16)' : 'rgba(124,111,255,0.09)',
    bottomBg: isDark ? '#0B0420' : '#FFFFFF',
    bottomBorder: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(23,22,48,0.07)',
    footerLink: isDark ? 'rgba(255,255,255,0.42)' : 'rgba(23,22,48,0.42)',
    footerMuted: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(23,22,48,0.28)',
  };

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const closeFade = useRef(new Animated.Value(0)).current;
  const benefitAnims = useRef(HERO_BENEFITS.map(() => new Animated.Value(0))).current;

  // ── Plan comparison: per-week rate, honest savings vs the priciest plan ──
  const plans = useMemo(() => {
    const list = (packages || []).slice().sort(
      (a, b) => (PLAN_ORDER[a.packageType] ?? 9) - (PLAN_ORDER[b.packageType] ?? 9)
    );
    const weeklyRate = (p) => {
      const weeks = WEEKS_IN_PERIOD[p.packageType];
      const price = p.product?.price;
      return weeks && price > 0 ? price / weeks : null;
    };
    const rates = list.map(weeklyRate).filter(r => r != null);
    const maxRate = rates.length ? Math.max(...rates) : null;
    return list.map(pkg => {
      const rate = weeklyRate(pkg);
      const raw = (maxRate && rate && rate < maxRate)
        ? Math.round((1 - rate / maxRate) * 100)
        : 0;
      return { pkg, rate, savings: raw >= 5 ? raw : 0 };
    });
  }, [packages]);

  // Best value = biggest real saving; ties go to the longest plan (list is sorted).
  const recommended = useMemo(() => {
    if (!plans.length) return null;
    return plans.reduce((best, p) => (p.savings > best.savings ? p : best), plans[0]).pkg;
  }, [plans]);

  // ── Free trial, if the store offers one on the selected plan ──
  const getTrial = (pkg) => {
    const product = pkg?.product;
    const intro = product?.introPrice;
    if (intro && intro.price === 0 && intro.periodNumberOfUnits > 0) {
      return { count: intro.periodNumberOfUnits, unit: String(intro.periodUnit || '').toUpperCase() };
    }
    const freePhase = product?.defaultOption?.freePhase?.billingPeriod;
    if (freePhase && freePhase.value > 0) {
      return { count: freePhase.value, unit: String(freePhase.unit || '').toUpperCase() };
    }
    return null;
  };

  const trialLabel = (trial) => {
    if (!trial) return null;
    const key = { DAY: 'trial_days', WEEK: 'trial_weeks', MONTH: 'trial_months' }[trial.unit];
    return key ? t(`paywall.${key}`, { count: trial.count }) : null;
  };

  const trial = trialLabel(getTrial(selectedPkg));

  // ── Close button countdown ──
  useEffect(() => {
    if (!visible) return;
    setCloseTimer(CLOSE_TIMER_SECONDS);
    closeFade.setValue(0);
    const interval = setInterval(() => {
      setCloseTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          Animated.timing(closeFade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, closeFade]);

  // ── Set system nav bar on Android ──
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const paywallBg = isDark ? '#0B0420' : '#FFFFFF';
    const appBg = isDark ? '#0f172a' : '#ffffff';
    SystemNavigationBar.setNavigationColor(visible ? paywallBg : appBg, isDark ? 'light' : 'dark');
  }, [visible, isDark]);

  // ── Entrance animation ──
  useEffect(() => {
    if (!visible) return;
    fadeAnim.setValue(0);
    slideAnim.setValue(40);
    benefitAnims.forEach(a => a.setValue(0));

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 550, easing: Easing.out(Easing.back(1.1)), useNativeDriver: true }),
    ]).start();

    Animated.stagger(90,
      benefitAnims.map(anim =>
        Animated.spring(anim, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true })
      )
    ).start();
  }, [visible, fadeAnim, slideAnim, benefitAnims]);

  // ── CTA pulse ──
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Preselect the best-value plan
  useEffect(() => {
    if (visible && recommended && !selectedPkg) setSelectedPkg(recommended);
  }, [visible, recommended, selectedPkg]);

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
  }, [visible, track]);

  const handleSelect = useCallback((pkg) => {
    triggerHapticFeedback('impactLight');
    setSelectedPkg(pkg);
    mixpanel.track('custom_paywall_plan_select', {
      source: track || 'unknown',
      package: pkg.identifier,
    });
  }, [triggerHapticFeedback, track]);

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg || loading) return;
    triggerHapticFeedback('impactMedium');
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
  }, [selectedPkg, loading, purchaseProduct, track, localState?.isPro, onClose, triggerHapticFeedback]);

  const handleRestore = useCallback(async () => {
    if (restoring) return;
    await restorePurchases(setRestoring);
    setTimeout(() => {
      if (localState?.isPro) onClose?.();
    }, 500);
  }, [restoring, restorePurchases, localState?.isPro, onClose]);

  // ── CTA copy: says exactly what will be charged ──
  const ctaSubtitle = (() => {
    if (!selectedPkg) return null;
    const price = selectedPkg.product?.priceString;
    if (!price) return null;
    if (selectedPkg.packageType === 'LIFETIME') {
      return t('paywall.cta_sub_lifetime', { price });
    }
    const periodKey = PERIOD_KEY[selectedPkg.packageType];
    const period = periodKey ? t(`paywall.${periodKey}`) : '';
    if (trial) return t('paywall.cta_sub_trial', { trial, price, period });
    return t('paywall.cta_sub', { price, period });
  })();

  const content = (
    <View style={[s.container, { backgroundColor: c.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={HERO_GRADIENT[0]} />

      {/* ══ SCROLLABLE BODY ══ */}
      <ScrollView
        style={s.scrollBody}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces
      >
        {/* ── Hero ── */}
        <View style={s.hero}>
          <Svg style={StyleSheet.absoluteFill}>
            <Defs>
              <SvgGradient id="heroGrad" x1="0" y1="0" x2="0.7" y2="1">
                <Stop offset="0" stopColor={HERO_GRADIENT[0]} />
                <Stop offset="0.55" stopColor={HERO_GRADIENT[1]} />
                <Stop offset="1" stopColor={HERO_GRADIENT[2]} />
              </SvgGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGrad)" />
          </Svg>

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

          <Animated.View style={[s.heroInner, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <SafeLottieView
              source={require('../../assets/Dance cat.json')}
              autoPlay
              loop
              resizeMode="contain"
              style={s.dancingCat}
              renderMode={Platform.OS === 'android' ? 'SOFTWARE' : 'HARDWARE'}
              cacheComposition={false}
            />
            <View style={s.proPill}>
              <Icon name="diamond" size={11} color="#3A1F8F" />
              <Text style={s.proPillText}>PRO</Text>
            </View>
            <Text style={s.heroTitle}>{t('paywall.title')}</Text>
            <Text style={s.heroSub}>{t('paywall.subtitle')}</Text>
          </Animated.View>
        </View>

        {/* ── Top 3 benefits ── */}
        <View style={s.benefitsList}>
          {HERO_BENEFITS.map((b, i) => (
            <Animated.View
              key={b.titleKey}
              style={[
                s.benefitRow,
                { backgroundColor: c.cardBg, borderColor: c.cardBorder },
                {
                  opacity: benefitAnims[i],
                  transform: [{
                    translateY: benefitAnims[i].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
                  }],
                },
              ]}
            >
              <View style={[s.benefitIconCircle, { backgroundColor: b.color + '22' }]}>
                <Icon name={b.icon} size={19} color={b.color} />
              </View>
              <View style={s.benefitTextWrap}>
                <Text style={[s.benefitTitle, { color: c.text }]}>{t(`paywall.${b.titleKey}`)}</Text>
                <Text style={[s.benefitDesc, { color: c.textSub }]}>{t(`paywall.${b.descKey}`)}</Text>
              </View>
              <Icon name="checkmark-circle" size={20} color="#34D399" />
            </Animated.View>
          ))}
        </View>

        {/* ── Secondary perks ── */}
        <Text style={[s.plusLabel, { color: c.textMuted }]}>{t('paywall.plus')}</Text>
        <View style={s.chipGrid}>
          {PERK_CHIPS.map(chip => (
            <View key={chip.labelKey} style={[s.chip, { backgroundColor: c.chipBg }]}>
              <Icon name={chip.icon} size={13} color={chip.color} />
              <Text style={[s.chipText, { color: c.textSub }]} numberOfLines={1}>
                {t(`paywall.${chip.labelKey}`)}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Close / countdown — always reachable, never scrolls away ── */}
      <View style={s.headerRow} pointerEvents="box-none">
        {canClose ? (
          <Animated.View style={{ opacity: closeFade }}>
            <TouchableOpacity
              onPress={onClose}
              style={[s.closeBtn, { backgroundColor: c.closeBtn }]}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            >
              <Icon name="close" size={18} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={s.timerBadge}>
            <Text style={s.timerText}>{closeTimer}</Text>
          </View>
        )}
      </View>

      {/* ══ FIXED BOTTOM: plans + CTA + footer ══ */}
      <View style={[s.fixedBottom, { backgroundColor: c.bottomBg, borderTopColor: c.bottomBorder }]}>
        {plans.length > 0 ? (
          <ScrollView
            style={s.planScroll}
            contentContainerStyle={s.planScrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {plans.map(({ pkg, rate, savings }, i) => {
              const isSelected = selectedPkg?.identifier === pkg.identifier;
              const isRecommended = recommended?.identifier === pkg.identifier;
              const planKey = PLAN_KEY[pkg.packageType];
              return (
                <TouchableOpacity
                  key={pkg.identifier || i}
                  onPress={() => handleSelect(pkg)}
                  activeOpacity={0.85}
                  style={[
                    s.planRow,
                    { backgroundColor: isSelected ? c.planBgActive : c.planBg, borderColor: isSelected ? BRAND : c.planBorder },
                  ]}
                >
                  {isRecommended && (
                    <View style={s.ribbon}>
                      <Text style={s.ribbonText}>
                        {savings ? t('paywall.save', { percent: savings }) : t('paywall.popular')}
                      </Text>
                    </View>
                  )}

                  <View style={[s.radio, { borderColor: isSelected ? BRAND : c.planBorder }]}>
                    {isSelected && <View style={s.radioDot} />}
                  </View>

                  <View style={s.planTextWrap}>
                    <Text style={[s.planLabel, { color: c.text }]}>
                      {PLAN_EMOJI[pkg.packageType] || '✨'}{'  '}
                      {planKey ? t(`paywall.${planKey}`) : (pkg.identifier || t('paywall.plan_default'))}
                    </Text>
                    {rate ? (
                      <Text style={[s.planPerWeek, { color: c.textMuted }]}>
                        {t('paywall.per_week', { price: formatMoney(pkg, rate) })}
                      </Text>
                    ) : null}
                  </View>

                  <Text style={[s.planPrice, { color: isSelected ? BRAND : c.text }]}>
                    {pkg.product?.priceString || '—'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="small" color={BRAND} />
            <Text style={[s.loadingText, { color: c.textMuted }]}>{t('paywall.loading')}</Text>
          </View>
        )}

        {/* CTA */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[s.ctaBtn, (loading || !selectedPkg) && s.ctaBtnDisabled]}
            onPress={handlePurchase}
            disabled={loading || !selectedPkg}
            activeOpacity={0.9}
          >
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgGradient id="ctaGrad" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#8B7BFF" />
                  <Stop offset="1" stopColor="#5A3FD6" />
                </SvgGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#ctaGrad)" />
            </Svg>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <View style={s.ctaInner}>
                <Text style={s.ctaText}>{trial ? t('paywall.cta_trial') : t('paywall.cta')}</Text>
                <Icon name="arrow-forward" size={18} color="#fff" style={s.ctaArrow} />
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {!!ctaSubtitle && (
          <Text style={[s.ctaSub, { color: c.textMuted }]} numberOfLines={2}>{ctaSubtitle}</Text>
        )}

        {/* Footer */}
        <View style={s.footerRow}>
          <TouchableOpacity onPress={handleRestore} disabled={restoring}>
            {restoring ? (
              <ActivityIndicator size="small" color={BRAND} />
            ) : (
              <Text style={[s.footerLink, { color: c.footerLink }]}>{t('paywall.restore')}</Text>
            )}
          </TouchableOpacity>
          <Text style={[s.footerDot, { color: c.footerMuted }]}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://adoptmevalues.app/terms')}>
            <Text style={[s.footerLink, { color: c.footerLink }]}>{t('paywall.terms')}</Text>
          </TouchableOpacity>
          <Text style={[s.footerDot, { color: c.footerMuted }]}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://adoptmevalues.app/privacy')}>
            <Text style={[s.footerLink, { color: c.footerLink }]}>{t('paywall.privacy')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // ── Inline mode: render as plain view (no modal) ──
  if (inline) return content;

  // ── Default: render inside a Modal ──
  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? onClose : undefined}>
      {content}
    </Modal>
  );
};

// ── Styles ──
const BOTTOM_SAFE = Platform.OS === 'ios' ? 28 : 14;
const STATUS_TOP = Platform.OS === 'ios' ? 52 : (StatusBar.currentHeight || 24) + 8;

const s = StyleSheet.create({
  container: { flex: 1 },

  scrollBody: { flex: 1 },
  scrollContent: { paddingBottom: 14 },

  // ── Hero ──
  hero: {
    paddingTop: STATUS_TOP,
    paddingBottom: SMALL_SCREEN ? 18 : 24,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
    overflow: 'hidden',
    alignItems: 'center',
  },
  sparkleOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.3,
  },
  headerRow: {
    position: 'absolute',
    top: STATUS_TOP,
    right: 16,
    zIndex: 10,
    elevation: 10, // Android: keep the tap target above the ScrollView
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(0,0,0,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timerText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '800',
  },
  heroInner: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  dancingCat: {
    width: SMALL_SCREEN ? 96 : 118,
    height: SMALL_SCREEN ? 96 : 118,
  },
  proPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFD93D',
    paddingHorizontal: 11,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  proPillText: {
    color: '#3A1F8F',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontSize: SMALL_SCREEN ? 25 : 29,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
    fontWeight: '600',
    marginTop: 5,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Benefits ──
  benefitsList: {
    paddingHorizontal: 16,
    marginTop: 16,
    gap: 8,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  benefitIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  benefitTextWrap: { flex: 1, marginRight: 8 },
  benefitTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.1,
  },
  benefitDesc: {
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
    lineHeight: 15,
  },

  // ── Perk chips ──
  plusLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 18,
    marginTop: 16,
    marginBottom: 8,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 7,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // ── Fixed bottom ──
  fixedBottom: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: BOTTOM_SAFE,
    borderTopWidth: 1,
  },
  planScroll: {
    maxHeight: height * 0.32,
  },
  planScrollContent: {
    paddingTop: 12, // headroom for the ribbon on the first row
    paddingBottom: 4,
    gap: 10,
  },

  // ── Plan rows ──
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  ribbon: {
    position: 'absolute',
    top: -9,
    right: 12,
    backgroundColor: '#FF6B6B',
    paddingHorizontal: 9,
    paddingVertical: 2.5,
    borderRadius: 999,
    shadowColor: '#FF6B6B',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  ribbonText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  radio: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 11,
  },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: BRAND,
  },
  planTextWrap: { flex: 1 },
  planLabel: {
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  planPerWeek: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '900',
    marginLeft: 8,
  },

  // ── Loading ──
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 22,
  },
  loadingText: {
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },

  // ── CTA ──
  ctaBtn: {
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 14,
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  ctaBtnDisabled: {
    opacity: 0.65,
  },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ctaArrow: {
    marginLeft: 7,
  },
  ctaText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  ctaSub: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
  },

  // ── Footer ──
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 6,
    flexWrap: 'wrap',
  },
  footerLink: {
    fontSize: 10.5,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footerDot: {
    fontSize: 10.5,
  },
});

export default SubscriptionScreen;
