/**
 * UserBadgeRail — every badge a player wears, drawn once for all surfaces.
 *
 *   inline (chat rows, online list, post and trade cards, chat header):
 *     Pro icon, then every badge as an icon, never wrapping, and the one
 *     authority pill (Admin / Mod / JMD) last: it is the only one that keeps
 *     its label, because moderation trust has to be readable in chat. Pro and
 *     the icons are all drawn at `size` so the row reads evenly. The name
 *     next to it should have flexShrink: 1 so it ellipsizes instead of
 *     pushing the rail off-row.
 *
 *   full (profile drawer): every badge as a labelled pill, wrapping, squad
 *     from the first counted friend. Pro is left to the banner.
 *
 * Which badges and in what order: Code/Helper/badgeRail.js. Tapping a name
 * already opens the profile drawer, which is where the full set lives.
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/Ionicons';
import UserBadgePill from './UserBadgePill';
import SquadBadge from '../Squad/SquadBadge';
import { badgeKeysFor, inlineOrder, AUTHORITY } from './badgeRail';

const PRO = require('../../assets/pro.png');
const VERIFIED = require('../../assets/verification.png');
const ROLE = {
  trusted: require('../../assets/role-badges/trusted.png'),
  cmsr_house: require('../../assets/role-badges/cmsr_house.png'),
  cmsr_art: require('../../assets/role-badges/cmsr_art.png'),
  helper: require('../../assets/role-badges/helper.png'),
};

// Per-theme colours for the labelled pills (full variant).
const TONES = {
  squad: {
    light: { bg: 'rgba(124,58,237,0.1)', border: 'rgba(124,58,237,0.25)', text: '#6d28d9' },
    dark: { bg: 'rgba(124,58,237,0.2)', border: 'rgba(167,139,250,0.4)', text: '#c4b5fd' },
  },
  verified: {
    light: { bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.25)', text: '#0ea5e9' },
    dark: { bg: 'rgba(56,189,248,0.15)', border: 'rgba(56,189,248,0.3)', text: '#38bdf8' },
  },
};
const tone = (key, isDarkMode) => TONES[key][isDarkMode ? 'dark' : 'light'];

const Glyph = ({ k, user, size }) => {
  if (k === 'squad') return <SquadBadge count={user.squadCount} size={size} />;
  const src = k === 'verified' ? VERIFIED : ROLE[k];
  if (!src) return null;
  return <Image source={src} style={{ width: size, height: size }} resizeMode="contain" />;
};

const SquadPill = ({ count, isDarkMode, t }) => {
  const c = tone('squad', isDarkMode);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }]}>
      <SquadBadge count={count} size={14} />
      <Text style={[styles.pillText, { color: c.text }]}>{t('squad.pill', { count })}</Text>
    </View>
  );
};

const VerifiedPill = ({ isDarkMode, t }) => {
  const c = tone('verified', isDarkMode);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Icon name="checkmark-circle" size={10} color={c.text} />
      <Text style={[styles.pillTextLight, { color: c.text }]}>{t('profile.verified')}</Text>
    </View>
  );
};

/**
 * @param user     {isAdmin, isModerator, isBabyMod, isTrusted, isCMSR, isArtCMSR, isHelper,
 *                  isPro, robloxUsernameVerified, squadCount}
 * @param variant  'inline' | 'full'
 * @param size     inline icon size in px (Pro and every badge icon)
 * @param allowed  badge keys this surface may show (badgeRail.ORDER by default)
 * @param children extra pills appended after the badges (full variant)
 */
const UserBadgeRail = React.memo(({
  user, variant = 'inline', size = 14, isDarkMode = false, allowed, style, children,
}) => {
  const { t } = useTranslation();
  if (!user) return null;
  const full = variant === 'full';
  const keys = badgeKeysFor(user, { allowed, squad: full ? 'any' : 'rank' });
  const shown = full ? keys : inlineOrder(keys);
  const showPro = !full && !!user.isPro;
  if (!showPro && shown.length === 0 && !children) return null;
  // One pill flashes: the first on the profile, the authority chip inline.
  // Icons never do.
  const glow = full ? shown[0] : shown.find((k) => AUTHORITY.includes(k));

  if (full) {
    return (
      <View style={[styles.full, style]}>
        {shown.map((k) => {
          if (k === 'squad') return <SquadPill key={k} count={user.squadCount} isDarkMode={isDarkMode} t={t} />;
          if (k === 'verified') return <VerifiedPill key={k} isDarkMode={isDarkMode} t={t} />;
          return <UserBadgePill key={k} type={k} size="md" isDarkMode={isDarkMode} glow={glow === k} />;
        })}
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.inline, style]}>
      {showPro && <Image source={PRO} style={{ width: size, height: size }} resizeMode="contain" />}
      {shown.map((k) => (AUTHORITY.includes(k)
        ? <UserBadgePill key={k} type={k} size="sm" isDarkMode={isDarkMode} glow={glow === k} />
        : <Glyph key={k} k={k} user={user} size={size} />))}
    </View>
  );
});

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  full: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 5 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 9, fontWeight: '800' },
  pillTextLight: { fontSize: 9, fontWeight: '700' },
});

export default UserBadgeRail;
