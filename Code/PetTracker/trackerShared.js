/**
 * trackerShared.js — small shared UI bits for the Pet Tracker screens.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

export const RARITY_COLORS = {
  common: '#95a5a6',
  uncommon: '#2ecc71',
  rare: '#3498db',
  'ultra-rare': '#9b59b6',
  legendary: '#f39c12',
};

export const GOAL_COLORS = {
  fullgrown: '#10B981',
  neon: '#2ecc71',
  mega: '#9b59b6',
};

export const STAGE_KEYS = {
  pet: ['newborn', 'junior', 'preteen', 'teen', 'postteen', 'fullgrown'],
  neon: ['reborn', 'twinkle', 'sparkle', 'flare', 'sunshine', 'luminous'],
};

/** Thin horizontal progress bar. */
export const ProgressBar = ({ pct, color, trackColor, height = 6, style }) => (
  <View
    style={[
      { height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' },
      style,
    ]}
  >
    <View
      style={{
        width: `${Math.min(100, Math.max(0, pct))}%`,
        height: '100%',
        borderRadius: height / 2,
        backgroundColor: color,
      }}
    />
  </View>
);

/** SVG progress ring with children rendered in the middle. */
export const ProgressRing = ({ size = 72, stroke = 7, pct, color, trackColor, children }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - clamped / 100)}
        />
      </Svg>
      {children}
    </View>
  );
};

export const getPetImageUrl = (item, baseImgUrl) => {
  if (!item?.image || !baseImgUrl) return '';
  return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
};
