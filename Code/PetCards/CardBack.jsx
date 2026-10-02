/**
 * CardBack — the back of a card. Uses the painted back from the CDN
 * (CB-STANDARD / CB-HAUNTED…) when it exists; otherwise a designed back drawn
 * in code: lacquered field, inset gold lines and a paw crest.
 */

import React, { memo } from 'react';
import { View, Image } from 'react-native';
import { assetUri } from './cardArt';

const BACKS = {
  island:  { asset: 'CB-STANDARD', field: ['#0B1F45', '#16336B', '#0A1A3A'], gold: '#E9C46A', dot: 'rgba(233,196,106,0.10)' },
  haunted: { asset: 'CB-HAUNTED', field: ['#12061F', '#3B1E5E', '#14081F'], gold: '#FF9A3C', dot: 'rgba(255,122,26,0.10)' },
  gold:    { asset: 'CB-GOLD', field: ['#B8860B', '#F7D774', '#A16207'], gold: '#FFF7D6', dot: 'rgba(255,255,255,0.12)' },
  pro:     { asset: 'CB-PRO', field: ['#05060A', '#1B2233', '#05060A'], gold: '#7DE3F5', dot: 'rgba(125,227,245,0.10)' },
};

function Paw({ size, color }) {
  const toe = size * 0.2;
  const toes = [[0.12, 0.3], [0.32, 0.1], [0.56, 0.1], [0.76, 0.3]];
  return (
    <View style={{ width: size, height: size }}>
      {toes.map(([x, y], i) => (
        <View key={i} style={{ position: 'absolute', left: x * size - toe * 0.1, top: y * size, width: toe, height: toe * 1.18, borderRadius: toe, backgroundColor: color }} />
      ))}
      <View style={{ position: 'absolute', left: size * 0.24, top: size * 0.46, width: size * 0.54, height: size * 0.42, borderRadius: size * 0.22, backgroundColor: color }} />
    </View>
  );
}

function CardBack({ width, theme = 'island', glow = null }) {
  const b = BACKS[theme] || BACKS.island;
  const h = width * 1.4;
  const u = width / 100;
  const uri = assetUri(b.asset);
  const crest = width * 0.42;
  return (
    <View
      style={{
        width, height: h, borderRadius: u * 4.6, overflow: 'hidden',
        backgroundImage: `radial-gradient(circle at 50% 50%, ${b.field[1]} 0%, ${b.field[0]} 55%, ${b.field[2]} 100%)`,
        boxShadow: glow ? `0 0 ${u * 9}px ${glow}` : `0 ${u * 1.5}px ${u * 4}px rgba(0,0,0,0.35)`,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ position: 'absolute', width, height: h }} resizeMode="cover" />
      ) : (
        <>
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundImage: `radial-gradient(circle at 20% 15%, ${b.dot} 0%, rgba(0,0,0,0) 30%), radial-gradient(circle at 80% 85%, ${b.dot} 0%, rgba(0,0,0,0) 30%)` }} />
          <View style={{ position: 'absolute', left: u * 4.5, top: u * 4.5, right: u * 4.5, bottom: u * 4.5, borderRadius: u * 3, borderWidth: Math.max(1, u * 0.7), borderColor: b.gold }} />
          <View style={{ position: 'absolute', left: u * 7, top: u * 7, right: u * 7, bottom: u * 7, borderRadius: u * 2, borderWidth: Math.max(0.5, u * 0.3), borderColor: b.gold, opacity: 0.6 }} />
          <View style={{ position: 'absolute', left: (width - crest) / 2, top: (h - crest) / 2, width: crest, height: crest, borderRadius: crest, borderWidth: Math.max(1, u * 0.9), borderColor: b.gold, alignItems: 'center', justifyContent: 'center', backgroundImage: `radial-gradient(circle at 50% 40%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 70%)` }}>
            <View style={{ position: 'absolute', width: crest * 0.84, height: crest * 0.84, borderRadius: crest, borderWidth: Math.max(0.5, u * 0.3), borderColor: b.gold, opacity: 0.7 }} />
            <Paw size={crest * 0.5} color={b.gold} />
          </View>
        </>
      )}
      {/* sheen */}
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundImage: 'linear-gradient(125deg, rgba(255,255,255,0) 35%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0) 65%)' }} />
    </View>
  );
}

export default memo(CardBack);
