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
// ONE wall, the current offering ('default'). Owner's call (2026-10-11): no
// second "discount" wall after closing this one. Callers still pass
// `showoffer` and `oneWallOnly`; both are ignored.
//
// It LOOKS LIKE ONBOARDING, on purpose. The first-run flow is welcome → sign
// in → this wall, and the old dark "game shop" at step three read as leaving
// the app. So it follows the app theme on onboarding's own background, shows
// the same logo, and its button is onboarding's Continue button: same colour
// (config.colors.hasBlockGreen), same corners, same word. The MM2 and Blox
// Fruit walls are this same screen in their own brand colour.
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, Image,
  StyleSheet, StatusBar, Platform, ActivityIndicator,
  Dimensions, Linking, Animated, Easing, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient as SvgRadial, Stop, Rect, Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import Purchases from 'react-native-purchases';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useGlobalState } from '../GlobelStats';
import { setNavBarColor, setThemedNavBar } from '../Helper/systemNavBar';
import { paywallPlacement, trackPaywallView, trackPaywallClose } from '../Helper/growthAnalytics';
import config from '../Helper/Environment';

const { width, height } = Dimensions.get('window');
const SMALL = height < 700;

// The logo onboarding shows (OnBoardingScreen.js picks it the same way).
const LOGO = config.isNoman ? require('../../assets/splashscreen.webp') : require('../../assets/logo.webp');

// Seconds before the × appears. Nothing is shown in its place while it waits;
// it simply appears. Owner's call (2026-10-12): 8 s on the first-run wall at
// the end of onboarding (was 7), 5 s everywhere else.
const CLOSE_DELAY_ONBOARDING = 8;
const CLOSE_DELAY = 5;

// ── Palette ──
const BRAND = '#FF6666';   // config.colors.hasBlockGreen — onboarding's Continue button
const ACCENT = '#3E8BFC';  // config.colors.secondary
const GOLD = '#FFC93C';    // the Pro badge (assets/pro.png)

// '#RRGGBB' + alpha → '#RRGGBBAA'
const tint = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

const makePalette = (isDark) => (isDark
  ? {
    BG: '#0f172a',          // onboarding's dark background
    NAV_STYLE: 'light',
    STATUS_STYLE: 'light-content',
    GLOW: 0.24,
    BRAND_TEXT: '#FF8080',
    TEXT: '#FFFFFF',        // onboarding title
    TEXT_SUB: '#CCCCCC',    // onboarding body text
    TEXT_MUTE: 'rgba(255,255,255,0.5)',
    CARD: 'rgba(255,255,255,0.06)',
    CARD_LINE: 'rgba(255,255,255,0.10)',
    DIVIDER: 'rgba(255,255,255,0.07)',
    TILE_ON: tint(BRAND, 0.18),
    SAVINGS_LINE: tint(BRAND, 0.45),
    CLOSE_BG: 'rgba(255,255,255,0.10)',
    CLOSE_ICON: 'rgba(255,255,255,0.85)',
    DOCK_BG: 'rgba(15,23,42,0.94)',
    DOCK_LINE: 'rgba(255,255,255,0.08)',
    FOOTER: 'rgba(255,255,255,0.45)',
    FOOTER_DOT: 'rgba(255,255,255,0.25)',
  }
  : {
    BG: '#f2f2f7',          // onboarding's light background
    NAV_STYLE: 'dark',
    STATUS_STYLE: 'dark-content',
    GLOW: 0.14,
    BRAND_TEXT: '#E04848',  // brand darkened so a price in it reads on white
    TEXT: '#000000',
    TEXT_SUB: '#666666',
    TEXT_MUTE: '#8E8E93',
    CARD: '#FFFFFF',
    CARD_LINE: '#E5E5EA',
    DIVIDER: '#EFEFF4',
    TILE_ON: tint(BRAND, 0.10),
    SAVINGS_LINE: tint(BRAND, 0.35),
    CLOSE_BG: 'rgba(0,0,0,0.06)',
    CLOSE_ICON: '#3C3C43',
    DOCK_BG: 'rgba(242,242,247,0.96)',
    DOCK_LINE: '#E5E5EA',
    FOOTER: '#8E8E93',
    FOOTER_DOT: '#C7C7CC',
  });

// ── What Pro actually unlocks ──
// Every line here is a real gate in the code, not a marketing claim:
//   no ads → BannerAdComponent / InterstitialAdManager skip Pro accounts
//   boosts → Trades.jsx features 2 trades a day for Pro, 12h each, no video
//   badge  → assets/pro.png renders beside the name on every trade
const BENEFITS = [
  { key: 'noads', icon: 'close-circle', tint: BRAND },
  { key: 'boost', icon: 'rocket', tint: ACCENT },
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

// ── Background: onboarding's flat colour, one soft brand glow at the top ──
const Backdrop = ({ P }) => (
  <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
    <Defs>
      <SvgRadial id="glowTop" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={BRAND} stopOpacity={P.GLOW} />
        <Stop offset="1" stopColor={BRAND} stopOpacity="0" />
      </SvgRadial>
    </Defs>
    <Rect x="0" y="0" width="100%" height="100%" fill={P.BG} />
    <Circle cx={width * 0.5} cy={height * 0.04} r={width * 0.8} fill="url(#glowTop)" />
  </Svg>
);

const SubscriptionScreen = ({ visible, onClose, track, inline }) => {
  const insets = useSafeAreaInsets();
  const { packages, purchaseProduct, restorePurchases, localState } = useLocalState();
  const { theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();

  const isDark = theme === 'dark';
  const P = useMemo(() => makePalette(isDark), [isDark]);
  const s = useMemo(() => makeStyles(P), [P]);

  const closeDelay = paywallPlacement(track) === 'onboarding' ? CLOSE_DELAY_ONBOARDING : CLOSE_DELAY;

  // Callers pass inline arrows, so a fresh onClose arrives every render. The
  // effects below must call the latest one without re-running for it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [selectedPkg, setSelectedPkg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [canClose, setCanClose] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const riseAnim = useRef(new Animated.Value(28)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const closeFade = useRef(new Animated.Value(0)).current;

  // ── Pricing: every plan measured against the priciest per-month rate ──
  //
  // The anchor is what the same stretch of time would cost on the most
  // expensive plan (in practice, monthly). Comparing to it produces both the
  // savings percentage and the amount saved. `packages` is the current
  // offering ('default'), loaded by LocalGlobelStats at launch.
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

      return { pkg, rate, savings, saved, freeMonths };
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

  // ── Analytics: one view per open ──
  useEffect(() => {
    if (visible) trackPaywallView(track);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close once Pro arrives (purchase or restore) ──
  // Watching the state instead of checking it after `await purchaseProduct()`:
  // a callback reads localState from the render it was made in — before the
  // purchase — so a check there never sees Pro and the wall stays open.
  // Someone who was already Pro when the wall opened is left alone.
  const proAtOpenRef = useRef(false);
  useEffect(() => {
    if (visible) proAtOpenRef.current = !!localState?.isPro;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (visible && localState?.isPro && !proAtOpenRef.current) onCloseRef.current?.();
  }, [visible, localState?.isPro]);

  // ── The × stays hidden for closeDelay seconds, then appears ──
  useEffect(() => {
    if (!visible) return;
    setCanClose(false);
    closeFade.setValue(0);
    const timer = setTimeout(() => {
      setCanClose(true);
      Animated.timing(closeFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }, closeDelay * 1000);
    return () => clearTimeout(timer);
  }, [visible, closeDelay, closeFade]);

  // ── Android system nav bar: match the wall, restore the app on exit ──
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
      setNavBarColor(P.BG, P.NAV_STYLE);
    } else if (styledNavBar.current) {
      styledNavBar.current = false;
      setThemedNavBar(theme);
    }
  }, [visible, theme, P.BG, P.NAV_STYLE]);

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
    if (!visible) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.025, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible, pulseAnim]);

  // Preselect the best-value plan — again if a fresh load replaces the list
  // the current pick came from.
  useEffect(() => {
    if (!visible || !recommended) return;
    if (!selectedPkg || !plans.some(p => p.pkg.identifier === selectedPkg.identifier)) {
      setSelectedPkg(recommended);
    }
  }, [visible, recommended, selectedPkg, plans]);

  // Reset on close
  useEffect(() => {
    if (!visible) {
      setSelectedPkg(null);
      setLoading(false);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    trackPaywallClose(track);
    onCloseRef.current?.();
  }, [track]);

  const handleSelect = useCallback((pkg) => {
    triggerHapticFeedback('impactLight');
    setSelectedPkg(pkg);
  }, [triggerHapticFeedback]);

  const handlePurchase = useCallback(async () => {
    if (!selectedPkg || loading) return;
    triggerHapticFeedback('impactMedium');
    // Success flips localState.isPro, and the effect above closes the wall.
    // purchaseProduct logs pro_purchase with `track`.
    await purchaseProduct(selectedPkg, setLoading, track);
  }, [selectedPkg, loading, purchaseProduct, track, triggerHapticFeedback]);

  // restorePurchases() swallows its result, so ask RevenueCat afterwards: a
  // Restore tap that silently does nothing reads as a broken button. A
  // successful restore flips isPro and the effect above closes the wall.
  const handleRestore = useCallback(async () => {
    if (restoring) return;
    await restorePurchases(setRestoring);
    try {
      const info = await Purchases.getCustomerInfo();
      const active = info?.entitlements?.active || {};
      if (!Object.keys(active).some(k => k.toLowerCase() === 'pro')) {
        Alert.alert(t('paywall.restore_none_title'), t('paywall.restore_none'));
      }
    } catch (e) {
      Alert.alert(t('paywall.restore_none_title'), t('paywall.restore_none'));
    }
  }, [restoring, restorePurchases, t]);

  // ── The button says "Continue", like every onboarding step before it. ──
  // It never repeats the price: the selected tile already shows it, and the
  // line under the button states exactly what gets charged — a third copy on
  // the button itself only gives the eye one more number to stop and re-check.
  const ctaLabel = t('paywall.cta');

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
      <StatusBar barStyle={P.STATUS_STYLE} />
      <Backdrop P={P} />

      {/* ══ TOP: what you get ══ */}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.scrollContent, { paddingTop: insets.top + 18 }]}
        showsVerticalScrollIndicator={false}
        bounces
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: riseAnim }] }}>
          {/* ── Hero: onboarding's logo, so step three still reads as the same app ── */}
          <View style={s.hero}>
            <Image resizeMethod="resize" source={LOGO} style={s.logo} resizeMode="contain" />
            <Text style={s.title}>{t('paywall.title')}</Text>
            <Text style={s.subtitle}>{t('paywall.subtitle')}</Text>
          </View>

          {/* ── One card, three promises, no scrolling to find them ── */}
          <View style={s.card}>
            {BENEFITS.map((b, i) => (
              <View key={b.key} style={[s.benefit, i > 0 && s.benefitDivider]}>
                <View style={[s.benefitIcon, { backgroundColor: tint(b.tint, 0.15) }]}>
                  {b.image
                    ? <Image resizeMethod="resize" source={b.image} style={s.benefitBadge} resizeMode="contain" />
                    : <Icon name={b.icon} size={19} color={b.tint} />}
                </View>
                <View style={s.benefitText}>
                  <Text style={s.benefitTitle}>{t(`paywall.${b.key}_title`)}</Text>
                  <Text style={s.benefitDesc}>{t(`paywall.${b.key}_desc`)}</Text>
                </View>
              </View>
            ))}

            <View style={s.extrasRow}>
              <Icon name="add-circle" size={13} color={P.TEXT_MUTE} />
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

      {/* ── Close — pinned, never scrolls away; absent until the delay ends ── */}
      {canClose && (
        <View style={[s.closeWrap, { top: insets.top + 10 }]} pointerEvents="box-none">
          <Animated.View style={{ opacity: closeFade }}>
            <TouchableOpacity
              onPress={handleClose}
              style={s.closeBtn}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
            >
              <Icon name="close" size={19} color={P.CLOSE_ICON} />
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}

      {/* ══ BOTTOM: the three offers, side by side, then one button ══ */}
      <View style={[s.dock, { paddingBottom: DOCK_PAD + insets.bottom }]}>
        {plans.length > 0 ? (
          <>
            <View style={s.tiles}>
              {plans.map(({ pkg, rate, savings }, i) => {
                const isSelected = selectedPkg?.identifier === pkg.identifier;
                const isBest = plans.length > 1 && recommended?.identifier === pkg.identifier;
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
                      <View style={s.saveTag}>
                        <Text style={s.saveTagText}>{t('paywall.save', { percent: savings })}</Text>
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
            <ActivityIndicator size="small" color={BRAND} />
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
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View style={s.ctaInner}>
                <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {ctaLabel}
                </Text>
                <Icon name="arrow-forward" size={19} color="#FFFFFF" style={s.ctaArrow} />
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {!!ctaSubtitle && <Text style={s.ctaSub} numberOfLines={2}>{ctaSubtitle}</Text>}

        <View style={s.footer}>
          <TouchableOpacity onPress={handleRestore} disabled={restoring} hitSlop={FOOTER_SLOP}>
            {restoring
              ? <ActivityIndicator size="small" color={BRAND} />
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
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={canClose ? handleClose : undefined}>
      {content}
    </Modal>
  );
};

// ── Styles ──
// insets.bottom is what actually clears the Android 3-button nav bar (~48dp);
// a fixed constant alone used to leave the buy button half-covered there.
const DOCK_PAD = 10;
const FOOTER_SLOP = { top: 10, bottom: 10, left: 8, right: 8 };

// Rebuilt whenever the theme flips; memoised by the component.
const makeStyles = (P) => StyleSheet.create({
  container: { flex: 1, backgroundColor: P.BG },

  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 10 },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: SMALL ? 12 : 16,
  },
  logo: {
    width: SMALL ? 88 : 104,
    height: SMALL ? 88 : 104,
    borderRadius: 18,
  },
  title: {
    color: P.TEXT,
    fontSize: SMALL ? 27 : 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginTop: 12,
    textAlign: 'center',
  },
  subtitle: {
    color: P.TEXT_SUB,
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'center',
  },

  // ── Benefits card ──
  card: {
    marginHorizontal: 18,
    backgroundColor: P.CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: P.CARD_LINE,
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
    borderTopColor: P.DIVIDER,
  },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
  },
  benefitBadge: { width: 23, height: 23 },
  benefitText: { flex: 1 },
  benefitTitle: {
    color: P.TEXT,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  benefitDesc: {
    color: P.TEXT_SUB,
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
    borderTopColor: P.DIVIDER,
    paddingVertical: 9,
  },
  extras: {
    flex: 1,
    color: P.TEXT_MUTE,
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
    backgroundColor: P.CLOSE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ══ Dock ══
  dock: {
    paddingHorizontal: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: P.DOCK_LINE,
    backgroundColor: P.DOCK_BG,
  },

  // ── Three offers, side by side ──
  tiles: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 7, // headroom for the SAVE tag sitting on the border
  },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: P.CARD_LINE,
    backgroundColor: P.CARD,
    paddingTop: 13,
    paddingBottom: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  // No elevation: a translucent fill with an Android shadow shows the shadow
  // through as a dark box. The brand border carries the selection.
  tileOn: {
    borderColor: BRAND,
    backgroundColor: P.TILE_ON,
  },
  saveTag: {
    position: 'absolute',
    top: -9,
    alignSelf: 'center',
    backgroundColor: BRAND,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 999,
  },
  saveTagText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  bestLabel: {
    color: P.BRAND_TEXT,
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  tilePlan: {
    color: P.TEXT_SUB,
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  tilePlanOn: { color: P.TEXT },
  tilePrice: {
    color: P.TEXT,
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.7,
    marginTop: 3,
  },
  tilePriceOn: { color: P.BRAND_TEXT },
  tilePerMonth: {
    color: P.TEXT_MUTE,
    fontSize: 10.5,
    fontWeight: '700',
    marginTop: 2,
  },
  tilePerMonthOn: { color: P.TEXT_SUB },

  // ── Savings line ──
  savingsBar: {
    marginTop: 9,
    alignSelf: 'center',
    backgroundColor: P.TILE_ON,
    borderWidth: 1,
    borderColor: P.SAVINGS_LINE,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  savingsText: {
    color: P.BRAND_TEXT,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },

  // ── Loading ──
  loadingWrap: { alignItems: 'center', paddingVertical: 26 },
  loadingText: { color: P.TEXT_MUTE, fontSize: 12, fontWeight: '600', marginTop: 8 },

  // ── CTA: onboarding's Continue button, a little taller ──
  cta: {
    height: 54,
    borderRadius: 12,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 11,
    shadowColor: BRAND,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    flexShrink: 1,
  },
  ctaArrow: { marginLeft: 8 },
  ctaSub: {
    color: P.TEXT_MUTE,
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
    color: P.FOOTER,
    fontSize: 11,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footerDot: { color: P.FOOTER_DOT, fontSize: 11 },
});

export default SubscriptionScreen;
