// OfferWall.jsx — Adopt Me Values Pro
//
// Who buys this: kids, usually with a parent looking over their shoulder. So
// the screen has exactly three jobs, in this order —
//   1. say what you get, in words a ten-year-old reads once,
//   2. show all three prices side by side so nothing is hidden,
//   3. make the yearly plan's 58% discount impossible to miss.
//
// The catalog is three subscriptions and no free trials:
//   $1.99 / month · $4.99 / 3 months · $9.99 / year
// A year bought month-by-month costs $23.88, so the yearly plan really is 58%
// off. Every discount on this screen is arithmetic on live store prices — never
// hardcoded — so it stays true in every currency and if pricing ever changes.
//
// The surface is deliberately one fixed dark "game shop" look in both app
// themes. A paywall is a branded storefront, not a settings page: the gold on
// near-black reads as treasure, and it keeps the price tiles legible without a
// second palette to maintain.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image,
  StyleSheet, StatusBar, Platform, ActivityIndicator,
  Dimensions, Linking, Animated, Easing, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Defs, LinearGradient as SvgLinear, RadialGradient as SvgRadial, Stop, Rect, Circle,
} from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import SafeLottieView from '../Helper/SafeLottieView';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { mixpanel } from '../AppHelper/MixPenel';
import { useGlobalState } from '../GlobelStats';
import { setNavBarColor, setThemedNavBar } from '../Helper/systemNavBar';

const { width, height } = Dimensions.get('window');
const SMALL = height < 700;

// ── Palette ──
const INK = '#0C0420';          // near-black indigo, the storefront floor
const INK_NAV = '#0C0420';
const VIOLET = '#8B5CF6';
const PINK = '#FF4D8D';
const GOLD = '#FFC93C';
const GOLD_DEEP = '#FF9F1C';
const TEXT = '#FFFFFF';
const TEXT_SUB = 'rgba(255,255,255,0.72)';
const TEXT_MUTE = 'rgba(255,255,255,0.46)';
const GLASS = 'rgba(255,255,255,0.06)';
const GLASS_LINE = 'rgba(255,255,255,0.10)';

// Seconds before the × appears. Kids close paywalls reflexively, so this is
// short on purpose — long enough to read the headline, not long enough to feel
// like a trap. Set to 0 to show the close button immediately.
const CLOSE_TIMER_SECONDS = 2;

// ── What Pro actually unlocks ──
// Every line here is a real gate in the code, not a marketing claim:
//   no ads → BannerAdComponent / InterstitialAdManager skip Pro accounts
//   boosts → Trades.jsx features 2 trades a day for Pro, 12h each, no video
//   badge  → assets/pro.png renders beside the name on every trade
const BENEFITS = [
  { key: 'noads', icon: 'close-circle', tint: PINK },
  { key: 'boost', icon: 'rocket', tint: VIOLET },
  { key: 'badge', image: require('../../assets/pro.png'), tint: GOLD },
];

// Longest plan first — the best deal should sit under the thumb, on the left,
// where the eye lands first.
const PLAN_ORDER = { LIFETIME: 0, ANNUAL: 1, SIX_MONTH: 2, THREE_MONTH: 3, TWO_MONTH: 4, MONTHLY: 5, WEEKLY: 6 };
// Months per billing period — the scale every price is compared on. Months, not
// weeks: a kid asking a parent for money thinks in months, and "$0.83 a month"
// lands where "$0.19 a week" just reads as noise.
const MONTHS_IN_PERIOD = { WEEKLY: 0.2301, MONTHLY: 1, TWO_MONTH: 2, THREE_MONTH: 3, SIX_MONTH: 6, ANNUAL: 12 };
const PLAN_KEY = {
  WEEKLY: 'plan_weekly', MONTHLY: 'plan_monthly', TWO_MONTH: 'plan_two_month',
  THREE_MONTH: 'plan_three_month', SIX_MONTH: 'plan_six_month', ANNUAL: 'plan_annual',
  LIFETIME: 'plan_lifetime',
};
const BILLED_KEY = {
  WEEKLY: 'billed_weekly', MONTHLY: 'billed_monthly', TWO_MONTH: 'billed_2months',
  THREE_MONTH: 'billed_3months', SIX_MONTH: 'billed_6months', ANNUAL: 'billed_yearly',
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

// ── Background: two soft colour glows over near-black ──
// Drawn once in SVG rather than stacked translucent Views, so it costs a single
// layer on Android instead of a pile of overdrawn rectangles.
const Backdrop = () => (
  <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
    <Defs>
      <SvgRadial id="glowTop" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={VIOLET} stopOpacity="0.55" />
        <Stop offset="1" stopColor={VIOLET} stopOpacity="0" />
      </SvgRadial>
      <SvgRadial id="glowBottom" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={PINK} stopOpacity="0.30" />
        <Stop offset="1" stopColor={PINK} stopOpacity="0" />
      </SvgRadial>
    </Defs>
    <Rect x="0" y="0" width="100%" height="100%" fill={INK} />
    <Circle cx={width * 0.5} cy={height * 0.05} r={width * 0.85} fill="url(#glowTop)" />
    <Circle cx={width * 0.1} cy={height * 0.62} r={width * 0.7} fill="url(#glowBottom)" />
  </Svg>
);

const SubscriptionScreen = ({ visible, onClose, track, showoffer, oneWallOnly, inline }) => {
  const insets = useSafeAreaInsets();
  const { packages, purchaseProduct, restorePurchases, localState } = useLocalState();
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [closeTimer, setCloseTimer] = useState(CLOSE_TIMER_SECONDS);
  const canClose = closeTimer <= 0;

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(28)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const closeFade = useRef(new Animated.Value(0)).current;

  // ── Pricing: every plan measured against the priciest per-month rate ──
  //
  // The anchor is what the same stretch of time would cost on the most
  // expensive plan (in practice, monthly). Comparing to it produces both the
  // struck-through "was" price and the savings percentage.
  const plans = useMemo(() => {
    const list = (packages || []).slice().sort(
      (a, b) => (PLAN_ORDER[a.packageType] ?? 9) - (PLAN_ORDER[b.packageType] ?? 9)
    );
    const monthlyRate = (p) => {
      const months = MONTHS_IN_PERIOD[p.packageType];
      const price = p.product?.price;
      return months && price > 0 ? price / months : null;
    };
    const rates = list.map(monthlyRate).filter(r => r != null);
    const anchorRate = rates.length ? Math.max(...rates) : null;

    return list.map(pkg => {
      const months = MONTHS_IN_PERIOD[pkg.packageType];
      const price = pkg.product?.price;
      const rate = monthlyRate(pkg);
      const anchorTotal = (anchorRate && months) ? anchorRate * months : null;

      // Only claim a saving when it is real and worth saying — anything under
      // 5% reads as a rounding artefact and cheapens the yearly plan's 58%.
      const pct = (anchorTotal && price > 0 && anchorTotal > price)
        ? Math.round((1 - price / anchorTotal) * 100)
        : 0;
      const savings = pct >= 5 ? pct : 0;
      const saved = savings ? anchorTotal - price : 0;

      // "Like 6 months free" — the money saved, in months of the anchor plan.
      // Floored on purpose: better to undersell than to round a claim up in a
      // kids' app that store reviewers read closely.
      const freeMonths = (savings && anchorRate) ? Math.floor(saved / anchorRate) : 0;

      return { pkg, rate, savings, saved, freeMonths, anchorTotal };
    });
  }, [packages]);

  // Best value = biggest real saving; ties go to the longest plan (list is sorted).
  const recommended = useMemo(() => {
    if (!plans.length) return null;
    return plans.reduce((best, p) => (p.savings > best.savings ? p : best), plans[0]).pkg;
  }, [plans]);

  const selectedPlan = useMemo(
    () => plans.find(p => p.pkg.identifier === selectedPkg?.identifier) || null,
    [plans, selectedPkg]
  );

  // ── Free trial, if the store ever offers one (none configured today) ──
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
    if (CLOSE_TIMER_SECONDS <= 0) {
      setCloseTimer(0);
      closeFade.setValue(1);
      return;
    }
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

  // ── Android system nav bar: match the storefront, restore the app on exit ──
  //
  // Home, Trades, Settings, Reward Center and Analytics all keep this mounted
  // with visible={false}, so the bar must not be touched until the wall has
  // actually been shown once. This used to paint a hardcoded dark navy on
  // mount whatever the theme was, which is why opening one of those tabs in
  // light mode turned the system bar dark and left it there.
  const styledNavBar = useRef(false);
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (visible) {
      styledNavBar.current = true;
      setNavBarColor(INK_NAV, 'light');
    } else if (styledNavBar.current) {
      styledNavBar.current = false;
      setThemedNavBar(theme);
    }
  }, [visible, theme]);

  // Closing is not the only way out — onboarding unmounts the inline wall
  // outright — so the bar is handed back on unmount too.
  useEffect(() => () => {
    if (styledNavBar.current) {
      styledNavBar.current = false;
      setThemedNavBar(themeRef.current);
    }
  }, []);

  // ── Entrance ──
  useEffect(() => {
    if (!visible) return;
    fadeAnim.setValue(0);
    riseAnim.setValue(28);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(riseAnim, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [visible, fadeAnim, riseAnim]);

  // ── CTA breathing ──
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.025, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
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

  useEffect(() => {
    if (visible) mixpanel.track('custom_paywall_presented', { source: track || 'unknown' });
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

  // ── The button never repeats the price. ──
  // The selected tile already shows it in gold, and the line under the button
  // states exactly what gets charged — a third copy on the button itself only
  // gives the eye one more number to stop and re-check before tapping.
  const ctaLabel = trial ? t('paywall.cta_trial') : t('paywall.cta');

  // ── And the line under it says exactly what is charged, and when. ──
  const ctaSubtitle = (() => {
    if (!selectedPkg) return null;
    const price = selectedPkg.product?.priceString;
    if (!price) return null;
    if (selectedPkg.packageType === 'LIFETIME') return t('paywall.cta_sub_lifetime', { price });
    const billedKey = BILLED_KEY[selectedPkg.packageType];
    const billed = billedKey ? t(`paywall.${billedKey}`) : '';
    if (trial) return t('paywall.cta_sub_trial', { trial, price, billed });
    return t('paywall.cta_sub', { price, billed });
  })();

  const content = (
    <View style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor={INK} translucent={false} />
      <Backdrop />

      {/* ══ TOP: what you get ══ */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + 14 }]}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: riseAnim }] }}>
          {/* ── Hero ── */}
          <View style={s.hero}>
            <View style={s.catRing}>
              <SafeLottieView
                source={require('../../assets/Dance cat.json')}
                autoPlay
                loop
                resizeMode="contain"
                style={s.cat}
                renderMode={Platform.OS === 'android' ? 'SOFTWARE' : 'HARDWARE'}
                cacheComposition={false}
              />
            </View>

            <Text style={s.title}>{t('paywall.title')}</Text>
            <Text style={s.subtitle}>{t('paywall.subtitle')}</Text>
          </View>

          {/* ── One glass card, three promises, no scrolling to find them ── */}
          <View style={s.card}>
            {BENEFITS.map((b, i) => (
              <View key={b.key} style={[s.benefit, i > 0 && s.benefitDivider]}>
                <View style={[s.benefitIcon, { backgroundColor: b.tint + '26' }]}>
                  {b.image
                    ? <Image source={b.image} style={s.benefitBadge} resizeMode="contain" />
                    : <Icon name={b.icon} size={19} color={b.tint} />}
                </View>
                <View style={s.benefitText}>
                  <Text style={s.benefitTitle}>{t(`paywall.${b.key}_title`)}</Text>
                  <Text style={s.benefitDesc}>{t(`paywall.${b.key}_desc`)}</Text>
                </View>
              </View>
            ))}

            <View style={s.extrasRow}>
              <Icon name="add-circle" size={13} color={TEXT_MUTE} />
              <Text style={s.extras} numberOfLines={2}>
                {[
                  t('paywall.extra_translate'), t('paywall.extra_wallpaper'),
                  t('paywall.extra_scam'), t('paywall.extra_stats'),
                ].join(' · ')}
              </Text>
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      {/* ── Close / countdown — pinned, never scrolls away ── */}
      <View style={[s.closeWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
        {canClose ? (
          <Animated.View style={{ opacity: closeFade }}>
            <TouchableOpacity
              onPress={onClose}
              style={s.closeBtn}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Icon name="close" size={19} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={s.closeBtn}>
            <Text style={s.timerText}>{closeTimer}</Text>
          </View>
        )}
      </View>

      {/* ══ BOTTOM: the three offers, side by side, then one button ══ */}
      <View style={[s.dock, { paddingBottom: DOCK_PAD + insets.bottom }]}>
        {plans.length > 0 ? (
          <>
            <View style={s.tiles}>
              {plans.map(({ pkg, rate, savings }, i) => {
                const isSelected = selectedPkg?.identifier === pkg.identifier;
                const isBest = recommended?.identifier === pkg.identifier;
                const planKey = PLAN_KEY[pkg.packageType];
                const showPerMonth = rate != null
                  && pkg.packageType !== 'MONTHLY'
                  && pkg.packageType !== 'LIFETIME';
                return (
                  <TouchableOpacity
                    key={pkg.identifier || i}
                    onPress={() => handleSelect(pkg)}
                    activeOpacity={0.9}
                    style={[s.tile, isSelected && s.tileOn]}
                  >
                    {savings > 0 && (
                      <View style={[s.saveTag, isSelected && s.saveTagOn]}>
                        <Text style={[s.saveTagText, isSelected && s.saveTagTextOn]}>
                          {t('paywall.save', { percent: savings })}
                        </Text>
                      </View>
                    )}

                    {isBest && <Text style={s.bestLabel}>{t('paywall.best_deal')}</Text>}

                    <Text style={[s.tilePlan, isSelected && s.tilePlanOn]} numberOfLines={1}>
                      {planKey ? t(`paywall.${planKey}`) : (pkg.identifier || t('paywall.plan_default'))}
                    </Text>

                    <Text
                      style={[s.tilePrice, isSelected && s.tilePriceOn]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.6}
                    >
                      {pkg.product?.priceString || '—'}
                    </Text>

                    {/* Reserved line so all three tiles stay the same height */}
                    <Text
                      style={[s.tilePerMonth, isSelected && s.tilePerMonthOn]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {showPerMonth ? t('paywall.per_month', { price: formatMoney(pkg, rate) }) : ' '}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* The saving, said the way a kid repeats it to a parent */}
            {!!selectedPlan && selectedPlan.savings > 0 && (
              <View style={s.savingsBar}>
                <Text style={s.savingsText} numberOfLines={1}>
                  {t('paywall.you_save', {
                    amount: formatMoney(selectedPlan.pkg, selectedPlan.saved),
                  })}
                  {selectedPlan.freeMonths >= 1
                    ? '  ·  ' + t('paywall.free_months', { count: selectedPlan.freeMonths })
                    : ''}
                </Text>
              </View>
            )}
          </>
        ) : (
          <View style={s.loadingWrap}>
            <ActivityIndicator size="small" color={GOLD} />
            <Text style={s.loadingText}>{t('paywall.loading')}</Text>
          </View>
        )}

        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[s.cta, (loading || !selectedPkg) && s.ctaOff]}
            onPress={handlePurchase}
            disabled={loading || !selectedPkg}
            activeOpacity={0.9}
          >
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <SvgLinear id="ctaGrad" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0" stopColor={GOLD} />
                  <Stop offset="1" stopColor={GOLD_DEEP} />
                </SvgLinear>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#ctaGrad)" />
            </Svg>
            {loading ? (
              <ActivityIndicator size="small" color={INK} />
            ) : (
              <View style={s.ctaInner}>
                <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {ctaLabel}
                </Text>
                <Icon name="arrow-forward" size={19} color={INK} style={s.ctaArrow} />
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {!!ctaSubtitle && <Text style={s.ctaSub} numberOfLines={2}>{ctaSubtitle}</Text>}

        <View style={s.footer}>
          <TouchableOpacity onPress={handleRestore} disabled={restoring} hitSlop={FOOTER_SLOP}>
            {restoring
              ? <ActivityIndicator size="small" color={GOLD} />
              : <Text style={s.footerLink}>{t('paywall.restore')}</Text>}
          </TouchableOpacity>
          <Text style={s.footerDot}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://adoptmevalues.app/terms')} hitSlop={FOOTER_SLOP}>
            <Text style={s.footerLink}>{t('paywall.terms')}</Text>
          </TouchableOpacity>
          <Text style={s.footerDot}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL('https://adoptmevalues.app/privacy')} hitSlop={FOOTER_SLOP}>
            <Text style={s.footerLink}>{t('paywall.privacy')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  if (inline) return content;

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? onClose : undefined}>
      {content}
    </Modal>
  );
};

// ── Styles ──
// insets.bottom is what actually clears the Android 3-button nav bar (~48dp);
// a fixed constant alone used to leave the buy button half-covered there.
const DOCK_PAD = 10;
const FOOTER_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 10 },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: SMALL ? 10 : 14,
  },
  catRing: {
    width: SMALL ? 96 : 112,
    height: SMALL ? 96 : 112,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cat: {
    width: SMALL ? 74 : 88,
    height: SMALL ? 74 : 88,
  },
  title: {
    color: TEXT,
    fontSize: SMALL ? 31 : 36,
    fontWeight: '900',
    letterSpacing: -1.1,
    marginTop: 10,
    textAlign: 'center',
  },
  subtitle: {
    color: TEXT_SUB,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'center',
  },

  // ── Benefits card ──
  card: {
    marginHorizontal: 18,
    backgroundColor: GLASS,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: GLASS_LINE,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  benefitDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  benefitBadge: { width: 23, height: 23 },
  benefitText: { flex: 1 },
  benefitTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  benefitDesc: {
    color: TEXT_SUB,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    marginTop: 2,
  },
  extrasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingVertical: 9,
  },
  extras: {
    flex: 1,
    color: TEXT_MUTE,
    fontSize: 11.5,
    fontWeight: '600',
    lineHeight: 16,
  },

  // ── Close ──
  closeWrap: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    elevation: 10, // Android: keep the tap target above the ScrollView
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '800',
  },

  // ══ Dock ══
  dock: {
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(8,3,20,0.92)',
  },

  // ── Three offers, side by side ──
  tiles: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 7, // headroom for the -58% tag sitting on the border
  },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingTop: 13,
    paddingBottom: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tileOn: {
    borderColor: GOLD,
    backgroundColor: 'rgba(255,201,60,0.13)',
    shadowColor: GOLD,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  saveTag: {
    position: 'absolute',
    top: -9,
    alignSelf: 'center',
    backgroundColor: PINK,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
  },
  saveTagOn: {
    backgroundColor: GOLD,
  },
  saveTagText: {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  saveTagTextOn: {
    color: INK,
  },
  bestLabel: {
    color: GOLD,
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  tilePlan: {
    color: TEXT_SUB,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  tilePlanOn: { color: TEXT },
  tilePrice: {
    color: TEXT,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 3,
  },
  tilePriceOn: { color: GOLD },
  tilePerMonth: {
    color: TEXT_MUTE,
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 2,
  },
  tilePerMonthOn: { color: TEXT_SUB },

  // ── Savings line ──
  savingsBar: {
    marginTop: 9,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,201,60,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,201,60,0.3)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  savingsText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  // ── Loading ──
  loadingWrap: { alignItems: 'center', paddingVertical: 26 },
  loadingText: { color: TEXT_MUTE, fontSize: 12, fontWeight: '600', marginTop: 8 },

  // ── CTA ──
  cta: {
    height: 58,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 11,
    shadowColor: GOLD_DEEP,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 9,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  ctaText: {
    color: INK,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  ctaArrow: { marginLeft: 8 },
  ctaSub: {
    color: TEXT_MUTE,
    fontSize: 11.5,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 9,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
    gap: 8,
    flexWrap: 'wrap',
  },
  footerLink: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footerDot: { color: 'rgba(255,255,255,0.22)', fontSize: 11 },
});

export default SubscriptionScreen;
