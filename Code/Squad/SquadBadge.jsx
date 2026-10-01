/**
 * SquadBadge — the image badge for a squad size or rank.
 *   1-2 friends: team token · 3 Recruiter (bronze) · 10 Leader (silver)
 *   25 Legend (gold) · 50 Icon (diamond). Art: Code/Assets/badges/squad_*.webp
 */
import React from 'react';
import { Image } from 'react-native';
import { rankFor } from '../Helper/squad';

const IMAGES = {
  squad: require('../Assets/badges/squad_squad.webp'),
  recruiter: require('../Assets/badges/squad_recruiter.webp'),
  leader: require('../Assets/badges/squad_leader.webp'),
  legend: require('../Assets/badges/squad_legend.webp'),
  icon: require('../Assets/badges/squad_icon.webp'),
};

/** Badge key for a friend count: null for 0, 'squad' below the first rank. */
export const squadBadgeKey = (count) => {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return rankFor(n)?.key || 'squad';
};

const SquadBadge = React.memo(({ count, rankKey, size = 16, style }) => {
  const key = rankKey || squadBadgeKey(count);
  if (!key || !IMAGES[key]) return null;
  return <Image source={IMAGES[key]} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
});

export default SquadBadge;
