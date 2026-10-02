/**
 * cardIcons — the tiny Pet Cards UI icons as images (no emoji glyphs, so they
 * look the same on every phone and keyboard font). Drawn by
 * scripts/pet-cards/make-icons.mjs at 1x/2x/3x; Metro picks the scale.
 *
 *   <CardIcon name="pin" size={16} />
 */

import React from 'react';
import { Image } from 'react-native';

export const ICONS = {
  pin:    require('../../assets/pet-cards/icons/pin.png'),      // show on profile
  pinOff: require('../../assets/pet-cards/icons/pin_off.png'),  // remove from profile
  share:  require('../../assets/pet-cards/icons/share.png'),
  score:  require('../../assets/pet-cards/icons/score.png'),    // collector score
  cards:  require('../../assets/pet-cards/icons/cards.png'),    // Pet Cards section
};

export default function CardIcon({ name, size = 18, style }) {
  const source = ICONS[name];
  if (!source) return null;
  return <Image source={source} style={[{ width: size, height: size }, style]} resizeMode="contain" />;
}
