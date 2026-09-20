import React, { useRef } from 'react';
import { View, Text, Animated, Image } from 'react-native';
import { getShimmerValue } from './shimmerDriver';

// Single source of truth for role/badge pill styling across chat lists,
// profile drawers, headers, post cards, and trade cards. Two visual tiers:
//   - 'authority' (admin / mod / jmd) → solid fill, white text
//   - 'community' (trusted / cmsr / helper) → soft tint, colored text + border
// Both adapt to light/dark via per-type tokens.
//
// Optional `glow` prop adds a lightning-streak shimmer across the pill.
// All shimmer pills in the app share ONE Animated.Value driven on the UI
// thread (see shimmerDriver.js) — adding glow to any number of pills costs
// the same as adding it to one. JS thread is idle during animation.
// Default: ON for the new 'helper' badge, OFF for everything else.

const TYPES = {
  admin:   { tier: 'authority', image: require('../../assets/role-badges/admin.png'),   label: 'Admin',   color: '#B91C1C', rim: '#F8D66D' },
  mod:     { tier: 'authority', image: require('../../assets/role-badges/mod.png'),     label: 'Mod',     color: '#6D28D9', rim: '#C4B5FD' },
  jmd:     { tier: 'authority', image: require('../../assets/role-badges/jmd.png'),     label: 'JMD',     color: '#D97706', rim: '#FDE68A' },
  trusted: { tier: 'community', image: require('../../assets/role-badges/trusted.png'), label: 'Trusted', color: '#059669', rim: '#6EE7B7' },
  cmsr:    { tier: 'community', image: require('../../assets/role-badges/cmsr.png'),    label: 'CMSR',    color: '#EA580C', rim: '#FDBA74' },
  helper:  { tier: 'community', image: require('../../assets/role-badges/helper.png'),  label: 'Helper',  color: '#0F766E', rim: '#5EEAD4' },
};

const SIZES = {
  sm: { fs: 9,  ic: 15, ph: 6,  pv: 2, gap: 3, br: 999 },
  md: { fs: 10, ic: 17, ph: 8,  pv: 3, gap: 4, br: 999 },
  lg: { fs: 11, ic: 19, ph: 10, pv: 4, gap: 5, br: 999 },
};

const hexAlpha = (hex, alphaHex) => `${hex}${alphaHex}`;

// Lightning streak that travels left → right inside the pill, clipped by
// overflow:'hidden' on the parent. Three stacked Animated.Views fake a soft
// gradient edge without pulling in react-native-linear-gradient. All three
// share the SAME interpolated translateX so the compositor only computes
// one transform per frame.
//
// Rendered AFTER the icon/text in JSX so the streak composites ON TOP — as
// it passes, the icon and label briefly flash white. pointerEvents='none'
// keeps the underlying tap targets intact.
//
// translateX output range [-40 → 180] covers any pill width up to ~140px
// (pills in this app are 40–110px). The streak is off-pill at both ends,
// visible for ~55% of the cycle. Rotation is static (20deg) so it
// composites without interpolation.
const ShimmerOverlay = React.memo(({ isDarkMode }) => {
  const shimmer = useRef(getShimmerValue()).current;
  const translateX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-40, 180],
  });
  // Subtle white streak — reads as a soft glint, not a hard flash. Dark mode
  // gets slightly more opacity since the pill backgrounds are darker.
  const tintHot  = isDarkMode ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.45)';
  const tintMid  = isDarkMode ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.18)';
  const tintSoft = isDarkMode ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.07)';
  const common = {
    position: 'absolute',
    top: -14,
    bottom: -14,
    left: 0,
    transform: [{ rotate: '20deg' }, { translateX }],
  };
  return (
    <>
      <Animated.View pointerEvents="none" style={[common, { width: 22, backgroundColor: tintSoft }]} />
      <Animated.View pointerEvents="none" style={[common, { width: 10, backgroundColor: tintMid }]} />
      <Animated.View pointerEvents="none" style={[common, { width: 3,  backgroundColor: tintHot }]} />
    </>
  );
});

const UserBadgePill = ({ type, size = 'md', isDarkMode = false, labelOverride, style, glow }) => {
  const def = TYPES[type];
  if (!def) return null;
  const s = SIZES[size] || SIZES.md;
  const label = labelOverride || def.label;
  // Glow is opt-in per pill. Call sites pass glow={firstBadge === '<type>'}
  // so only the first/highest-priority badge a user owns flashes; the rest
  // stay static. This avoids visual noise when a user wears multiple pills.
  const shouldGlow = !!glow;

  if (def.tier === 'authority') {
    return (
      <View
        style={[{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: def.color,
          borderWidth: 1,
          borderColor: def.rim,
          paddingHorizontal: s.ph,
          paddingVertical: s.pv,
          borderRadius: s.br,
          gap: s.gap,
          overflow: shouldGlow ? 'hidden' : undefined,
        }, style]}
      >
        <Image source={def.image} style={{ width: s.ic, height: s.ic }} resizeMode="contain" />
        <Text style={{ color: '#fff', fontSize: s.fs, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {label}
        </Text>
        {shouldGlow && <ShimmerOverlay isDarkMode={isDarkMode} />}
      </View>
    );
  }

  // community tier — soft tint + colored text + matching border
  const bg = hexAlpha(def.color, isDarkMode ? '26' : '1A');     // ~15% dark, ~10% light
  const border = hexAlpha(def.color, isDarkMode ? '66' : '40'); // ~40% dark, ~25% light
  return (
    <View
      style={[{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        paddingHorizontal: s.ph,
        paddingVertical: s.pv,
        borderRadius: s.br,
        gap: s.gap,
        overflow: shouldGlow ? 'hidden' : undefined,
      }, style]}
    >
      <Image source={def.image} style={{ width: s.ic, height: s.ic }} resizeMode="contain" />
      <Text style={{ color: def.color, fontSize: s.fs, fontWeight: '800', letterSpacing: 0.35 }}>
        {label}
      </Text>
      {shouldGlow && <ShimmerOverlay isDarkMode={isDarkMode} />}
    </View>
  );
};

// Resolves the highest-priority pill for a user, mirroring legacy mutually
// exclusive logic for authority badges (admin > mod > jmd). Returns null if
// no role applies. Use <UserRolePills user={...} /> for the full set.
export const getPrimaryRoleType = (u) => {
  if (!u) return null;
  if (u.isAdmin) return 'admin';
  if (u.isModerator) return 'mod';
  if (u.isBabyMod) return 'jmd';
  return null;
};

// Returns the highest-priority badge type that the user actually has AND
// that the calling surface actually renders. Used to pick which single pill
// gets the lightning glow when a user owns more than one badge.
//
// `allowed` lets each surface restrict the set — e.g. OnlineUsersList doesn't
// render the JMD pill, so passing ['admin','mod','trusted','cmsr','helper']
// makes the helper skip jmd and treat the next visible badge as first.
const HAS = {
  admin:   (u) => !!u.isAdmin,
  mod:     (u) => !u.isAdmin && !!u.isModerator,
  jmd:     (u) => !u.isAdmin && !u.isModerator && !!u.isBabyMod,
  trusted: (u) => !!u.isTrusted,
  cmsr:    (u) => !!u.isCMSR,
  helper:  (u) => !!u.isHelper,
};
const DEFAULT_BADGE_ORDER = ['admin', 'mod', 'jmd', 'trusted', 'cmsr', 'helper'];
export const getFirstBadgeType = (u, allowed = DEFAULT_BADGE_ORDER) => {
  if (!u) return null;
  for (const t of allowed) {
    if (HAS[t] && HAS[t](u)) return t;
  }
  return null;
};

// Convenience: render every applicable pill for a user, in canonical order.
// Authority (mutually exclusive) → Trusted → CMSR → Helper.
// Pass `include` to opt out of specific tiers (e.g. ['community'] to hide auth).
export const UserRolePills = ({ user, size = 'md', isDarkMode = false, includeAuthority = true, includeCommunity = true, style, gap = 5 }) => {
  if (!user) return null;
  const pills = [];
  if (includeAuthority) {
    const primary = getPrimaryRoleType(user);
    if (primary) pills.push(primary);
  }
  if (includeCommunity) {
    if (user.isTrusted) pills.push('trusted');
    if (user.isCMSR)    pills.push('cmsr');
    if (user.isHelper)  pills.push('helper');
  }
  if (pills.length === 0) return null;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap }, style]}>
      {pills.map((t) => (
        <UserBadgePill key={t} type={t} size={size} isDarkMode={isDarkMode} />
      ))}
    </View>
  );
};

export default UserBadgePill;
