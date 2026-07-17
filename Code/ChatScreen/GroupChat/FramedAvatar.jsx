import { getThemeColors } from '../../Helper/themeColors';
/**
 * FramedAvatar.jsx — Premium Ornamental Profile Frames
 *
 * Each frame has unique SVG artwork: crowns, wings, gems, sparkles,
 * flames, ribbons. Thick gradient-filled borders with dark outlines.
 *
 * Tiers:
 *   Common    → Simple gradient ring
 *   Uncommon  → Gradient ring + sparkle accents
 *   Rare      → Thick ornate border + gem mounts + Lottie
 *   Legendary → Crown/wing decorations + gems + triple ring + Lottie
 *   Exclusive → Full ornamental frame + all effects + Lottie
 */

import React, { useMemo } from 'react';
import { View, Image } from 'react-native';
import Svg, {
  Path,
  Circle as SvgCircle,
  Defs,
  ClipPath,
  Image as SvgImage,
  RadialGradient,
  LinearGradient,
  Stop,
  G,
} from 'react-native-svg';

// ── Level-of-detail threshold ──────────────────────────────
// Ornate decoration shapes (crowns, gems, halos, orbits…) only render on
// avatars at/above this size — the "hero" surfaces where users actually
// admire a frame: profile card (56), egg reveal (64), profile drawer (72),
// badge showcase (96), cosmetics preview (~180). Every dense list/message/
// inbox/header avatar is smaller and renders just the ring + glow, keeping
// each one to a handful of SVG nodes so long scrolling lists stay smooth.
// Tune this one number if profiling ever shows list jank on low-end devices.
const FRAME_FULL_DETAIL_MIN = 54;
// ════════════════════════════════════════════════════════════
//  DECORATIVE SVG ELEMENT GENERATORS
//  These create the actual artwork that makes frames look premium
// ════════════════════════════════════════════════════════════

/**
 * Crown decoration — sits on top of the avatar
 * Returns SVG path data for a 3 or 5-pointed crown
 */
const drawCrown = (cx, topY, width, height, points = 3) => {
  const hw = width / 2;
  const baseY = topY + height;
  const peakH = height * 0.9;

  if (points === 5) {
    // 5-pointed ornate crown
    const spacing = width / 4;
    return `M ${cx - hw} ${baseY}
      L ${cx - hw} ${topY + height * 0.5}
      L ${cx - hw + spacing * 0.5} ${topY + peakH * 0.45}
      L ${cx - hw + spacing} ${topY + peakH * 0.7}
      L ${cx - hw + spacing * 1.5} ${topY}
      L ${cx} ${topY + peakH * 0.55}
      L ${cx + hw - spacing * 1.5} ${topY}
      L ${cx + hw - spacing} ${topY + peakH * 0.7}
      L ${cx + hw - spacing * 0.5} ${topY + peakH * 0.45}
      L ${cx + hw} ${topY + height * 0.5}
      L ${cx + hw} ${baseY} Z`;
  }
  // 3-pointed crown
  return `M ${cx - hw} ${baseY}
    L ${cx - hw} ${topY + height * 0.45}
    L ${cx - hw * 0.5} ${topY}
    L ${cx} ${topY + height * 0.4}
    L ${cx + hw * 0.5} ${topY}
    L ${cx + hw} ${topY + height * 0.45}
    L ${cx + hw} ${baseY} Z`;
};

/**
 * Wing decoration — sits on left or right side
 * side: -1 for left, 1 for right
 */
const drawWing = (cx, cy, size, side = 1) => {
  const s = size;
  const x = cx + side * s * 0.1;
  return `M ${x} ${cy}
    Q ${x + side * s * 0.5} ${cy - s * 0.6} ${x + side * s * 0.95} ${cy - s * 0.35}
    Q ${x + side * s * 0.7} ${cy - s * 0.15} ${x + side * s * 0.6} ${cy + s * 0.05}
    Q ${x + side * s * 0.65} ${cy + s * 0.3} ${x + side * s * 0.85} ${cy + s * 0.55}
    Q ${x + side * s * 0.5} ${cy + s * 0.35} ${x} ${cy + s * 0.15} Z`;
};

/**
 * Diamond gem shape — filled gem with highlight
 */
const drawGem = (cx, cy, size) => {
  const s = size;
  return `M ${cx} ${cy - s}
    L ${cx + s * 0.7} ${cy}
    L ${cx} ${cy + s}
    L ${cx - s * 0.7} ${cy} Z`;
};

/**
 * 4-pointed sparkle star
 */
const drawSparkle = (cx, cy, outerR, innerR) => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
};

/**
 * Flame lick — single flame shape
 */
const drawFlame = (cx, bottomY, width, height, lean = 0) => {
  const hw = width / 2;
  const topY = bottomY - height;
  return `M ${cx - hw} ${bottomY}
    Q ${cx - hw * 0.3 + lean} ${topY + height * 0.4} ${cx + lean * 0.5} ${topY}
    Q ${cx + hw * 0.3 + lean} ${topY + height * 0.4} ${cx + hw} ${bottomY} Z`;
};

/**
 * Small ribbon/banner at bottom
 */
const drawRibbon = (cx, cy, width, height) => {
  const hw = width / 2;
  const hh = height / 2;
  return `M ${cx - hw * 1.3} ${cy - hh}
    L ${cx - hw} ${cy}
    L ${cx - hw * 1.3} ${cy + hh}
    L ${cx - hw * 0.3} ${cy + hh * 0.6}
    L ${cx} ${cy + hh}
    L ${cx + hw * 0.3} ${cy + hh * 0.6}
    L ${cx + hw * 1.3} ${cy + hh}
    L ${cx + hw} ${cy}
    L ${cx + hw * 1.3} ${cy - hh} Z`;
};

/**
 * Scalloped/ornate circle border (wavy edge)
 */
const scallopedCirclePath = (cx, cy, r, scallops = 16, depth = 0.08) => {
  let d = '';
  const step = (Math.PI * 2) / scallops;
  for (let i = 0; i < scallops; i++) {
    const a1 = i * step;
    const a2 = (i + 1) * step;
    const aMid = (a1 + a2) / 2;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const cpx = cx + r * (1 + depth) * Math.cos(aMid);
    const cpy = cy + r * (1 + depth) * Math.sin(aMid);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy + r * Math.sin(a2);
    if (i === 0) d += `M ${x1.toFixed(2)} ${y1.toFixed(2)} `;
    d += `Q ${cpx.toFixed(2)} ${cpy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} `;
  }
  d += 'Z';
  return d;
};

/**
 * Full ellipse as a Path (two arc commands). Used instead of <Ellipse>,
 * whose ViewManager setter isn't wired on this build's new architecture
 * (react-native-svg) — Path renders identically and is universally safe.
 */
const ellipsePath = (cx, cy, rx, ry) =>
  `M ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} `
  + `A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(cx + rx).toFixed(2)} ${cy.toFixed(2)} `
  + `A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 1 0 ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} Z`;

/** Lightning-bolt fork centred on the origin (translate/rotate into place). */
const drawBolt = (s) =>
  `M ${(-0.9 * s).toFixed(2)} ${(-3.2 * s).toFixed(2)} `
  + `L ${(1.5 * s).toFixed(2)} ${(-0.5 * s).toFixed(2)} `
  + `L ${(0.2 * s).toFixed(2)} ${(-0.5 * s).toFixed(2)} `
  + `L ${(1.3 * s).toFixed(2)} ${(2.1 * s).toFixed(2)} `
  + `L ${(-1.3 * s).toFixed(2)} ${(-0.5 * s).toFixed(2)} `
  + `L ${(0.1 * s).toFixed(2)} ${(-0.5 * s).toFixed(2)} Z`;

/** Heart shape centred at (cx,cy), half-width ~s. */
const heartPath = (cx, cy, s) =>
  `M ${cx.toFixed(2)} ${(cy + s * 0.35).toFixed(2)} `
  + `C ${cx.toFixed(2)} ${cy.toFixed(2)}, ${(cx - s).toFixed(2)} ${(cy - s * 0.05).toFixed(2)}, ${(cx - s).toFixed(2)} ${(cy - s * 0.45).toFixed(2)} `
  + `C ${(cx - s).toFixed(2)} ${(cy - s * 0.95).toFixed(2)}, ${(cx - s * 0.35).toFixed(2)} ${(cy - s).toFixed(2)}, ${cx.toFixed(2)} ${(cy - s * 0.55).toFixed(2)} `
  + `C ${(cx + s * 0.35).toFixed(2)} ${(cy - s).toFixed(2)}, ${(cx + s).toFixed(2)} ${(cy - s * 0.95).toFixed(2)}, ${(cx + s).toFixed(2)} ${(cy - s * 0.45).toFixed(2)} `
  + `C ${(cx + s).toFixed(2)} ${(cy - s * 0.05).toFixed(2)}, ${cx.toFixed(2)} ${cy.toFixed(2)}, ${cx.toFixed(2)} ${(cy + s * 0.35).toFixed(2)} Z`;

// ════════════════════════════════════════════════════════════
//  FRAME DEFINITIONS — decoration configs per frame
// ════════════════════════════════════════════════════════════
const FRAME_DEFS = {
  // ═══ COMMON — simple gradient ring ═══
  hot_pink_ring:      { borderWidth: 2.2, gap: 1.2, decorations: [] },
  electric_blue_ring: { borderWidth: 2.2, gap: 1.2, decorations: [] },
  neon_green_ring:    { borderWidth: 2.2, gap: 1.2, decorations: [] },
  bright_purple_ring: { borderWidth: 2.2, gap: 1.2, decorations: [] },
  sunny_yellow_ring:  { borderWidth: 2.2, gap: 1.2, decorations: [] },
  coral_ring:         { borderWidth: 2.2, gap: 1.2, decorations: [] },

  // ═══ UNCOMMON — sparkle accents, thin ring ═══
  fire_ring: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles', 'flames'],
    scalloped: false,
  },
  frost_crystal: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles'],
    scalloped: true,
  },
  ocean_wave: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles'],
    scalloped: true,
  },
  butterfly_wings: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.2,
    decorScale: 0.85,
    decorations: ['sparkles', 'wings'],
  },

  // ═══ RARE — slim border, gems, tight double ring ═══
  diamond: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.4,
    decorScale: 1.2,
    decorations: ['gems', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  neon_unicorn: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.45,
    decorScale: 1.2,
    decorations: ['gems', 'sparkles', 'crown3'],
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  cherry_blossom: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.4,
    decorScale: 1.15,
    decorations: ['gems', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  cotton_cloud: {
    borderWidth: 2.5,
    gap: 1.5,
    glowOpacity: 0.4,
    decorScale: 1.15,
    decorations: ['gems', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },

  // ═══ LEGENDARY — crowns/wings, compact triple ring, strong glow ═══
  rainbow_glow: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['crown5', 'gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },
  starlight_princess: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['crown3', 'gems', 'sparkles', 'wings'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },
  royal_crown: {
    borderWidth: 3.2,
    gap: 2,
    glowOpacity: 0.7,
    decorScale: 1.7,
    decorations: ['crown5', 'gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.3,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
    scalloped: true,
  },
  neon_kawaii: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['sparkles', 'gems', 'wings'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },

  // ═══ UNCOMMON — simple rainbow ring ═══
  rainbow_simple: {
    borderWidth: 2.2,
    gap: 1.2,
    glowOpacity: 0.15,
    decorScale: 0.8,
    decorations: ['sparkles'],
    scalloped: false,
  },

  // ═══ EXCLUSIVE — max decorations, compact rings ═══
  rainbow_royale: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },
  crystal_heart: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown3', 'gems', 'sparkles', 'wings', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
    scalloped: true,
  },
  holographic: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'wings', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },

  // ═══ LEVEL REWARD FRAMES ═══
  sparkle: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['sparkles', 'gems', 'crown3'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
  },
  tradeBorder: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.65,
    decorScale: 1.6,
    decorations: ['gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.7,
    scalloped: true,
  },
  animatedFrame: {
    borderWidth: 3.5,
    gap: 2,
    glowOpacity: 0.85,
    decorScale: 2.0,
    decorations: ['crown5', 'gems', 'sparkles', 'wings', 'flames'],
    doubleBorder: true,
    doubleBorderWidth: 1.4,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },

  // ═══════════════════════════════════════════════════════════
  //  MODERN ELEGANT SERIES (girly-chic aesthetic, static colors)
  // ═══════════════════════════════════════════════════════════

  // ── COMMON — clean minimalist rings ──
  pearl_shimmer: { borderWidth: 2.2, gap: 1.2, decorations: [] },
  blush_silk:    { borderWidth: 2.2, gap: 1.2, decorations: [] },

  // ── UNCOMMON — sparkles + elegant accents ──
  champagne_ribbon: {
    borderWidth: 2.3,
    gap: 1.3,
    glowOpacity: 0.22,
    decorScale: 0.95,
    decorations: ['sparkles', 'ribbon'],
    scalloped: true,
  },
  lilac_petal: {
    borderWidth: 2.3,
    gap: 1.3,
    glowOpacity: 0.22,
    decorScale: 0.95,
    decorations: ['sparkles', 'wings'],
  },
  sage_mist: {
    borderWidth: 2.3,
    gap: 1.3,
    glowOpacity: 0.2,
    decorScale: 0.9,
    decorations: ['sparkles'],
    scalloped: true,
  },

  // ── RARE — gems, double ring, scalloped ──
  peach_sorbet: {
    borderWidth: 2.6,
    gap: 1.6,
    glowOpacity: 0.5,
    decorScale: 1.3,
    decorations: ['gems', 'sparkles', 'wings'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  dusty_rose_frame: {
    borderWidth: 2.6,
    gap: 1.6,
    glowOpacity: 0.5,
    decorScale: 1.3,
    decorations: ['gems', 'sparkles', 'crown3'],
    doubleBorder: true,
    doubleBorderWidth: 1,
  },

  // ── LEGENDARY — crown + wings + triple ring, strong glow ──
  moonstone_glow: {
    borderWidth: 3.2,
    gap: 2,
    glowOpacity: 0.78,
    decorScale: 1.8,
    decorations: ['crown3', 'gems', 'sparkles', 'wings'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1.3,
    tripleBorder: true,
    tripleBorderWidth: 0.75,
  },
  rose_gold_luxe: {
    borderWidth: 3.2,
    gap: 2,
    glowOpacity: 0.78,
    decorScale: 1.8,
    decorations: ['crown5', 'gems', 'sparkles', 'ribbon'],
    doubleBorder: true,
    doubleBorderWidth: 1.3,
    tripleBorder: true,
    tripleBorderWidth: 0.75,
  },

  // ── EXCLUSIVE — every decoration, max glow ──
  celestial_pearl: {
    borderWidth: 3.7,
    gap: 2.1,
    glowOpacity: 0.95,
    decorScale: 2.1,
    decorations: ['crown5', 'gems', 'sparkles', 'wings', 'ribbon', 'flames'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1.5,
    tripleBorder: true,
    tripleBorderWidth: 0.85,
  },

  // ═══════════════════════════════════════════════════════════
  //  ADVANCED SERIES (batch 1) — new decoration vocabulary
  //  (halo / orbit / laurel). Full art shows on hero avatars only
  //  (>= FRAME_FULL_DETAIL_MIN); lists render ring + glow.
  // ═══════════════════════════════════════════════════════════
  seraph_halo: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.75,
    decorScale: 1.6,
    decorations: ['halo', 'wings', 'sparkles'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
  },
  cosmic_orbit: {
    borderWidth: 2.6,
    gap: 1.8,
    glowOpacity: 0.8,
    decorScale: 1.6,
    decorations: ['orbit', 'sparkles'],
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  laurel_champion: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.6,
    decorScale: 1.6,
    decorations: ['laurel', 'gems'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1.2,
  },
  phoenix_ember: {
    borderWidth: 3.4,
    gap: 2,
    glowOpacity: 0.9,
    decorScale: 1.9,
    decorations: ['crown3', 'wings', 'flames', 'sparkles'],
    doubleBorder: true,
    doubleBorderWidth: 1.3,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },
  storm_caller: {
    borderWidth: 3,
    gap: 1.8,
    glowOpacity: 0.8,
    decorScale: 1.6,
    decorations: ['bolts', 'sparkles'],
    doubleBorder: true,
    doubleBorderWidth: 1.2,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },
  heart_aura: {
    borderWidth: 2.6,
    gap: 1.6,
    glowOpacity: 0.7,
    decorScale: 1.5,
    decorations: ['hearts', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  rose_thorn: {
    borderWidth: 2.6,
    gap: 1.6,
    glowOpacity: 0.55,
    decorScale: 1.4,
    decorations: ['vines', 'sparkles'],
    scalloped: true,
    doubleBorder: true,
    doubleBorderWidth: 1,
  },
  aurora_shimmer: {
    borderWidth: 4,
    gap: 1.8,
    glowOpacity: 0.8,
    decorScale: 1.5,
    decorations: ['sparkles'],
    shimmer: true,
    doubleBorder: true,
    tripleBorder: true,
    tripleBorderWidth: 0.8,
  },
};

const DEFAULT_DEF = {
  borderWidth: 2, gap: 1, decorations: [],
};

// Unique ID counter
let _framedAvatarIdCounter = 0;

// ════════════════════════════════════════════════════════════
//  RENDER DECORATIONS — the core of the premium look
// ════════════════════════════════════════════════════════════
const renderDecorations = ({
  decorations, cx, cy, avatarR, borderR, colors, gradId, isDark, scale, decorScale = 1,
}) => {
  if (!decorations || decorations.length === 0) return null;
  const elements = [];
  const primary = colors[0] || '#94a3b8';
  const secondary = colors[1] || primary;
  // Scale factor: avatar size * tier decoration multiplier
  const sf = Math.max(0.5, scale) * decorScale;

  decorations.forEach((dec) => {
    switch (dec) {
      // ── CROWN (3 points) ──
      case 'crown3': {
        const crownW = avatarR * 1.0 * sf;
        const crownH = avatarR * 0.45 * sf;
        const crownTop = cy - borderR - crownH * 0.6;
        const crownPath = drawCrown(cx, crownTop, crownW, crownH, 3);
        elements.push(
          <G key="crown3">
            {/* Crown shadow */}
            <Path d={crownPath} fill={primary} opacity={0.2}
              transform={`translate(0, ${1.5 * sf})`} />
            {/* Crown body */}
            <Path d={crownPath} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1.2 * sf}
              strokeLinejoin="round" />
            {/* Crown highlight */}
            <Path d={crownPath} fill="#ffffff" opacity={0.15} />
            {/* Crown tip gems */}
            {[-0.5, 0.5].map((offset, i) => {
              const tipX = cx + offset * crownW * 0.5;
              const tipY = crownTop + 1 * sf;
              return (
                <G key={`ct-${i}`}>
                  <SvgCircle cx={tipX} cy={tipY} r={1.8 * sf} fill="#ffffff" opacity={0.9} />
                  <SvgCircle cx={tipX} cy={tipY} r={1.0 * sf} fill={primary} opacity={0.8} />
                </G>
              );
            })}
            {/* Center gem */}
            <SvgCircle cx={cx} cy={crownTop + crownH * 0.38} r={2 * sf}
              fill={secondary} stroke="#ffffff" strokeWidth={0.5 * sf} />
          </G>
        );
        break;
      }

      // ── CROWN (5 points) ──
      case 'crown5': {
        const crownW = avatarR * 1.2 * sf;
        const crownH = avatarR * 0.55 * sf;
        const crownTop = cy - borderR - crownH * 0.5;
        const crownPath = drawCrown(cx, crownTop, crownW, crownH, 5);
        elements.push(
          <G key="crown5">
            {/* Shadow */}
            <Path d={crownPath} fill={primary} opacity={0.15}
              transform={`translate(0, ${2 * sf})`} />
            {/* Body */}
            <Path d={crownPath} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1.3 * sf}
              strokeLinejoin="round" />
            {/* Highlight sheen */}
            <Path d={crownPath} fill="#ffffff" opacity={0.12} />
            {/* 5 tip gems */}
            {[-1.5, -0.5, 0, 0.5, 1.5].map((offset, i) => {
              const tipX = cx + offset * crownW * 0.27;
              const tipY = crownTop + (i === 2 ? crownH * 0.5 : (Math.abs(offset) > 1 ? crownH * 0.4 : 0));
              const gemR = (i === 2 ? 2.2 : 1.6) * sf;
              return (
                <G key={`ct5-${i}`}>
                  <SvgCircle cx={tipX} cy={tipY} r={gemR + 1 * sf}
                    fill={colors[i % colors.length]} opacity={0.3} />
                  <SvgCircle cx={tipX} cy={tipY} r={gemR}
                    fill={colors[i % colors.length]}
                    stroke="#ffffff" strokeWidth={0.4 * sf} />
                  <SvgCircle cx={tipX - 0.4 * sf} cy={tipY - 0.5 * sf} r={gemR * 0.35}
                    fill="#ffffff" opacity={0.7} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── WINGS ──
      case 'wings': {
        const wingSize = avatarR * 0.7 * sf;
        const leftWing = drawWing(cx - borderR * 0.85, cy - avatarR * 0.1, wingSize, -1);
        const rightWing = drawWing(cx + borderR * 0.85, cy - avatarR * 0.1, wingSize, 1);
        elements.push(
          <G key="wings">
            {/* Wing shadows */}
            <Path d={leftWing} fill={primary} opacity={0.15}
              transform={`translate(${-1 * sf}, ${1.5 * sf})`} />
            <Path d={rightWing} fill={primary} opacity={0.15}
              transform={`translate(${1 * sf}, ${1.5 * sf})`} />
            {/* Wing bodies */}
            <Path d={leftWing} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1 * sf}
              strokeLinejoin="round" opacity={0.85} />
            <Path d={rightWing} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={1 * sf}
              strokeLinejoin="round" opacity={0.85} />
            {/* Wing highlights */}
            <Path d={leftWing} fill="#ffffff" opacity={0.1} />
            <Path d={rightWing} fill="#ffffff" opacity={0.1} />
          </G>
        );
        break;
      }

      // ── GEMS (4 cardinal gem mounts) ──
      case 'gems': {
        const gemSize = Math.max(2.5, avatarR * 0.12) * sf;
        const gemR = borderR + 1 * sf;
        const positions = [
          { x: cx, y: cy - gemR, angle: 0 },         // top
          { x: cx + gemR, y: cy, angle: 90 },         // right
          { x: cx, y: cy + gemR, angle: 180 },        // bottom
          { x: cx - gemR, y: cy, angle: 270 },        // left
        ];
        elements.push(
          <G key="gems">
            {positions.map((pos, i) => {
              const gemPath = drawGem(pos.x, pos.y, gemSize);
              const gemColor = colors[i % colors.length];
              return (
                <G key={`gem-${i}`}>
                  {/* Gem glow */}
                  <SvgCircle cx={pos.x} cy={pos.y} r={gemSize * 1.8}
                    fill={gemColor} opacity={0.2} />
                  {/* Gem shadow */}
                  <Path d={gemPath} fill="#000000" opacity={0.2}
                    transform={`translate(0, ${0.8 * sf})`} />
                  {/* Gem body */}
                  <Path d={gemPath} fill={gemColor}
                    stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={0.8 * sf}
                    strokeLinejoin="round" />
                  {/* Gem highlight facet */}
                  <Path
                    d={`M ${pos.x} ${pos.y - gemSize}
                      L ${pos.x + gemSize * 0.3} ${pos.y - gemSize * 0.2}
                      L ${pos.x - gemSize * 0.3} ${pos.y - gemSize * 0.2} Z`}
                    fill="#ffffff" opacity={0.5} />
                  {/* Gem sparkle dot */}
                  <SvgCircle cx={pos.x - gemSize * 0.2} cy={pos.y - gemSize * 0.4}
                    r={gemSize * 0.18} fill="#ffffff" opacity={0.8} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── SPARKLES (8 small 4-pointed stars) ──
      case 'sparkles': {
        const sparkR = borderR + avatarR * 0.2 * sf;
        const sparkSize = Math.max(1.8, avatarR * 0.08) * sf;
        elements.push(
          <G key="sparkles">
            {Array.from({ length: 8 }).map((_, i) => {
              const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
              const x = cx + sparkR * Math.cos(angle);
              const y = cy + sparkR * Math.sin(angle);
              const sSize = sparkSize * (i % 2 === 0 ? 1 : 0.65);
              const sparkPath = drawSparkle(x, y, sSize, sSize * 0.3);
              const color = colors[i % colors.length];
              return (
                <G key={`sp-${i}`}>
                  {/* Sparkle glow */}
                  <SvgCircle cx={x} cy={y} r={sSize * 1.8}
                    fill={color} opacity={0.15} />
                  {/* Sparkle body */}
                  <Path d={sparkPath} fill={color} opacity={0.85} />
                  {/* Sparkle center dot */}
                  <SvgCircle cx={x} cy={y} r={sSize * 0.25}
                    fill="#ffffff" opacity={0.9} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── FLAMES (bottom fire licks) ──
      case 'flames': {
        const flameCount = 5;
        const flameArcStart = Math.PI * 0.55;
        const flameArcEnd = Math.PI * 0.95;
        elements.push(
          <G key="flames">
            {Array.from({ length: flameCount }).map((_, i) => {
              const t = i / (flameCount - 1);
              const angle = flameArcStart + t * (flameArcEnd - flameArcStart);
              const fx = cx + borderR * 0.95 * Math.cos(angle);
              const fy = cy + borderR * 0.95 * Math.sin(angle);
              const fh = avatarR * (0.3 + ((i * 7 + 3) % 5) * 0.03) * sf;
              const fw = avatarR * 0.18 * sf;
              const lean = (t - 0.5) * fw * 0.3;
              const flamePath = drawFlame(fx, fy, fw, fh, lean);
              const fColor = colors[i % Math.max(colors.length, 2)];
              return (
                <G key={`fl-${i}`}>
                  <Path d={flamePath} fill={fColor} opacity={0.6}
                    transform={`translate(0, ${1 * sf})`} />
                  <Path d={flamePath} fill={fColor} opacity={0.85} />
                  <Path d={flamePath} fill="#ffffff" opacity={0.08} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── RIBBON (bottom banner) ──
      case 'ribbon': {
        const ribW = avatarR * 1.1 * sf;
        const ribH = avatarR * 0.22 * sf;
        const ribY = cy + borderR + ribH * 0.4;
        const ribbonPath = drawRibbon(cx, ribY, ribW, ribH);
        elements.push(
          <G key="ribbon">
            <Path d={ribbonPath} fill={primary} opacity={0.15}
              transform={`translate(0, ${1 * sf})`} />
            <Path d={ribbonPath} fill={`url(#${gradId})`}
              stroke={isDark ? '#0f172a' : '#1e293b'} strokeWidth={0.8 * sf}
              strokeLinejoin="round" />
            <Path d={ribbonPath} fill="#ffffff" opacity={0.1} />
          </G>
        );
        break;
      }

      // ── HALO — glowing torus ring floating above the head ──
      case 'halo': {
        const haloY = cy - borderR - avatarR * 0.34 * sf;
        const hrx = avatarR * 0.72 * sf;
        const hry = avatarR * 0.24 * sf;
        elements.push(
          <G key="halo">
            {/* Soft glow behind the ring */}
            <Path d={ellipsePath(cx, haloY, hrx * 1.25, hry * 1.5)} fill={primary} opacity={0.22} />
            {/* Gradient torus */}
            <Path d={ellipsePath(cx, haloY, hrx, hry)} fill="none"
              stroke={`url(#${gradId})`} strokeWidth={3 * sf} />
            {/* White inner highlight */}
            <Path d={ellipsePath(cx, haloY, hrx, hry)} fill="none"
              stroke="#ffffff" strokeWidth={0.8 * sf} opacity={0.55} />
          </G>
        );
        break;
      }

      // ── ORBIT — tilted ring circled by little planets/moons ──
      case 'orbit': {
        const orx = borderR + avatarR * 0.42 * sf;
        const ory = borderR * 0.5;
        elements.push(
          <G key="orbit" transform={`rotate(-18 ${cx} ${cy})`}>
            {/* Orbit path */}
            <Path d={ellipsePath(cx, cy, orx, ory)} fill="none"
              stroke={primary} strokeWidth={0.9 * sf} opacity={0.5}
              strokeDasharray={`${2 * sf},${2.5 * sf}`} />
            {[0, 2.4, 4.5].map((a, i) => {
              const px = cx + orx * Math.cos(a);
              const py = cy + ory * Math.sin(a);
              const col = colors[i % colors.length];
              const r = (i === 0 ? 3.2 : 2.2) * sf;
              return (
                <G key={`orb-${i}`}>
                  <SvgCircle cx={px} cy={py} r={r * 1.9} fill={col} opacity={0.3} />
                  <SvgCircle cx={px} cy={py} r={r} fill={col} stroke="#ffffff" strokeWidth={0.4 * sf} />
                  <SvgCircle cx={px - r * 0.3} cy={py - r * 0.3} r={r * 0.35} fill="#ffffff" opacity={0.8} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── LAUREL — victory wreath branches curving up both sides ──
      case 'laurel': {
        const branchColor = colors[2] || primary;
        elements.push(
          <G key="laurel">
            {[-1, 1].map((side) => {
              const bx = cx + side * borderR * 0.92;
              const leaves = [];
              for (let i = 0; i < 5; i++) {
                const tt = i / 4.5;
                const ly = cy + borderR * 0.7 - tt * borderR * 1.5;
                const lx = bx + side * (avatarR * 0.42 * Math.sin(tt * Math.PI));
                const rot = side * (35 + tt * 25);
                leaves.push(
                  <Path key={`lf-${side}-${i}`}
                    d={ellipsePath(lx, ly, avatarR * 0.19 * sf, avatarR * 0.08 * sf)}
                    fill={`url(#${gradId})`} stroke={isDark ? '#065f46' : '#047857'}
                    strokeWidth={0.4 * sf} transform={`rotate(${rot} ${lx} ${ly})`} />
                );
              }
              return (
                <G key={`br-${side}`}>
                  <Path
                    d={`M ${bx} ${cy + borderR * 0.75} Q ${bx + side * avatarR * 0.5} ${cy} ${bx - side * avatarR * 0.05} ${cy - borderR * 0.8}`}
                    fill="none" stroke={branchColor} strokeWidth={1.6 * sf} strokeLinecap="round" />
                  {leaves}
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── BOLTS — lightning forks radiating from the ring ──
      case 'bolts': {
        elements.push(
          <G key="bolts">
            {[[-2.3, 1.1], [-0.85, 1.25], [0.85, 1.2], [2.3, 1.1]].map(([a, rm], i) => {
              const bx = cx + borderR * rm * Math.cos(a);
              const by = cy + borderR * rm * Math.sin(a);
              const col = colors[i % colors.length];
              const rot = a * 57.3 + 90;
              const path = drawBolt(2.6 * sf);
              return (
                <G key={`bolt-${i}`} transform={`translate(${bx.toFixed(2)} ${by.toFixed(2)}) rotate(${rot.toFixed(1)})`}>
                  <Path d={path} fill={col} opacity={0.35} transform="scale(1.7)" />
                  <Path d={path} fill={col} stroke="#ffffff" strokeWidth={0.35 * sf} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── HEARTS — floating hearts orbiting the ring ──
      case 'hearts': {
        elements.push(
          <G key="hearts">
            {Array.from({ length: 6 }).map((_, i) => {
              const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
              const hr = borderR + avatarR * 0.16 * sf;
              const hx = cx + hr * Math.cos(a);
              const hy = cy + hr * Math.sin(a);
              const hs = (i % 2 ? 2.4 : 3.4) * sf;
              const col = colors[i % colors.length];
              return (
                <G key={`heart-${i}`}>
                  <Path d={heartPath(hx, hy, hs * 1.5)} fill={col} opacity={0.25} />
                  <Path d={heartPath(hx, hy, hs)} fill={col} stroke="#ffffff" strokeWidth={0.35 * sf} />
                  <SvgCircle cx={hx - hs * 0.35} cy={hy - hs * 0.35} r={hs * 0.22} fill="#ffffff" opacity={0.7} />
                </G>
              );
            })}
          </G>
        );
        break;
      }

      // ── VINES — thorned ring studded with rose buds ──
      case 'vines': {
        elements.push(
          <G key="vines">
            <Path d={scallopedCirclePath(cx, cy, borderR, Math.round(18 * scale), 0.05)}
              fill="none" stroke={colors[2] || '#166534'} strokeWidth={1.4 * sf} opacity={0.85} />
            {Array.from({ length: 6 }).map((_, i) => {
              const a = (i / 6) * Math.PI * 2 - 1.2;
              const rx = cx + borderR * Math.cos(a);
              const ry = cy + borderR * Math.sin(a);
              const rs = avatarR * 0.13 * sf;
              return (
                <G key={`rose-${i}`}>
                  <Path d={ellipsePath(rx - rs, ry, rs * 0.7, rs * 0.4)}
                    fill="#15803d"
                    transform={`rotate(${(a * 57.3).toFixed(1)} ${rx.toFixed(2)} ${ry.toFixed(2)})`} />
                  <SvgCircle cx={rx} cy={ry} r={rs * 1.4} fill={primary} opacity={0.25} />
                  <SvgCircle cx={rx} cy={ry} r={rs} fill={primary} />
                  <SvgCircle cx={rx} cy={ry} r={rs * 0.55} fill={secondary} />
                  <SvgCircle cx={rx} cy={ry} r={rs * 0.2} fill="#ffffff" opacity={0.7} />
                </G>
              );
            })}
          </G>
        );
        break;
      }
    }
  });

  return <>{elements}</>;
};

// ════════════════════════════════════════════════════════════
//  FRAMED AVATAR COMPONENT
// ════════════════════════════════════════════════════════════
const FramedAvatar = ({
  avatarUri,
  frame,
  isDarkMode = false,
  avatarSize = 72,
  isOnline,
  // Force full ornate detail regardless of size — for prominent single "hero"
  // avatars below the LOD threshold (e.g. the Home header) where we still want
  // the crowns/gems to show. Leave false for dense lists to keep them light.
  forceDetail = false,
}) => {
  const c = getThemeColors(isDarkMode);
  const instanceId = useMemo(() => `fa-${++_framedAvatarIdCounter}`, []);
  const def = frame?.id ? (FRAME_DEFS[frame.id] || DEFAULT_DEF) : null;
  const borderColors = frame?.borderColors || [];
  const glowColor = frame?.glowColor || null;
  const primaryColor = borderColors[0] || '#94a3b8';
  // ── No frame: simple circular avatar ──
  if (!frame || !def) {
    const showOnline = isOnline !== undefined && avatarSize >= 40;
    return (
      <View style={{ position: 'relative' }}>
        <View style={{
          width: avatarSize, height: avatarSize,
          borderRadius: avatarSize / 2,
          borderWidth: Math.max(1, avatarSize * 0.028),
          borderColor: c.bg,
          overflow: 'hidden',
          backgroundColor: c.border,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
            />
          ) : null}
        </View>
        {showOnline && (
          <View style={{
            position: 'absolute', bottom: 0, right: 0,
            width: Math.max(8, avatarSize * 0.22), height: Math.max(8, avatarSize * 0.22),
            borderRadius: Math.max(4, avatarSize * 0.11),
            backgroundColor: isOnline ? '#22c55e' : '#94a3b8',
            borderWidth: Math.max(1, avatarSize * 0.035),
            borderColor: c.bg,
            zIndex: 11,
          }} />
        )}
      </View>
    );
  }

  // ── Level of detail: draw ornate decorations only on large (hero)
  //    avatars. Below the threshold we render just the ring + glow, which
  //    also drops the extra padding those decorations would need — so a
  //    compact framed avatar keeps the same footprint as a plain one and
  //    lists stay light. See FRAME_FULL_DETAIL_MIN.
  const showDecor = forceDetail || avatarSize >= FRAME_FULL_DETAIL_MIN;
  const activeDecor = showDecor ? (def.decorations || []) : [];

  // ── Scale factor for decorations (1 = 72px avatar) ──
  const scale = avatarSize / 72;
  const avatarR = avatarSize / 2;
  const totalPadding = def.gap + def.borderWidth;

  // Extra room for decorations — scale with decorScale to handle higher tiers
  const ds = def.decorScale || 1;
  const hasLargeProtrusions = activeDecor.some(d =>
    ['crown3', 'crown5', 'wings', 'flames', 'ribbon', 'halo', 'laurel', 'orbit', 'bolts', 'hearts'].includes(d));
  const hasSideProtrusions = activeDecor.some(d =>
    ['gems', 'sparkles', 'vines'].includes(d));
  const extraPad = hasLargeProtrusions
    ? avatarR * 0.55 * scale * Math.max(1, ds * 0.75)
    : hasSideProtrusions
      ? avatarR * 0.4 * scale * Math.max(1, ds * 0.75)
      : avatarR * 0.15 * scale;
  const svgSize = avatarSize + totalPadding * 2 + extraPad * 2;
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  // Radii
  const innerR = avatarR - 1;
  const borderR = avatarR + def.gap;
  const outerR = borderR + def.borderWidth;
  const tripleR = outerR + 2.5 * scale;

  // Border path (main ring or scalloped)
  const mainBorderPath = def.scalloped
    ? scallopedCirclePath(cx, cy, borderR, Math.round(20 * scale), 0.06)
    : null;

  const showOnline = isOnline !== undefined && avatarSize >= 40;

  // Build gradient stops
  const gradientStops = borderColors.length > 1
    ? borderColors.map((color, i) => ({
        offset: `${(i / (borderColors.length - 1)) * 100}%`,
        color,
      }))
    : [{ offset: '0%', color: primaryColor }, { offset: '100%', color: primaryColor }];

  const gradId = `grad-${instanceId}`;
  const grad2Id = `grad2-${instanceId}`;
  const glowId = `glow-${instanceId}`;
  const clipId = `clip-${instanceId}`;

  // ══════════════════════════════════════════════════
  //  SVG FRAME — pure SVG with decorations
  // ══════════════════════════════════════════════════
  return (
    <View style={{ position: 'relative', overflow: 'visible' }}>
      <Svg width={svgSize} height={svgSize} overflow="visible" style={{ overflow: 'visible' }}>
        <Defs>
          {/* Avatar clip */}
          <ClipPath id={clipId}>
            <SvgCircle cx={cx} cy={cy} r={innerR} />
          </ClipPath>

          {/* Main gradient */}
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            {gradientStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
            ))}
          </LinearGradient>

          {/* Secondary gradient (reversed) */}
          <LinearGradient id={grad2Id} x1="100%" y1="0%" x2="0%" y2="100%">
            {gradientStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.5} />
            ))}
          </LinearGradient>

          {/* Radial glow — intensity scales with tier */}
          {glowColor && (
            <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
              <Stop offset="25%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.3) * 0.9} />
              <Stop offset="50%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.3) * 0.5} />
              <Stop offset="80%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.3) * 0.15} />
              <Stop offset="100%" stopColor={glowColor} stopOpacity={0} />
            </RadialGradient>
          )}
        </Defs>

        {/* ── Layer 1: Radial glow ── */}
        {glowColor && (
          <SvgCircle cx={cx} cy={cy} r={svgSize / 2 - 1}
            fill={`url(#${glowId})`} />
        )}

        {/* ── Layer 2: Triple ring (outermost dashed) ── */}
        {def.tripleBorder && (
          <SvgCircle cx={cx} cy={cy} r={tripleR}
            stroke={`url(#${grad2Id})`} strokeWidth={(def.tripleBorderWidth || 0.8) * scale}
            fill="none" opacity={0.5}
            strokeDasharray={`${3 * scale},${2 * scale}`}
            strokeLinecap="round" />
        )}

        {/* ── Layer 3: Double border (outer ring) ── */}
        {def.doubleBorder && (
          <SvgCircle cx={cx} cy={cy} r={outerR}
            stroke={`url(#${grad2Id})`} strokeWidth={(def.doubleBorderWidth || 1.5) * scale}
            fill="none" opacity={0.6} />
        )}

        {/* ── Layer 4: Dark outer outline (contrast) ── */}
        <SvgCircle cx={cx} cy={cy}
          r={borderR + def.borderWidth * scale / 2 + 0.3}
          stroke={isDarkMode ? '#0f172a' : '#1e293b'}
          strokeWidth={0.7 * scale}
          fill="none" opacity={0.25} />

        {/* ── Layer 5: Main gradient border ── */}
        {def.scalloped ? (
          <>
            <Path d={mainBorderPath}
              stroke={`url(#${gradId})`}
              strokeWidth={def.borderWidth * scale}
              fill={c.border}
              strokeLinejoin="round" />
            {/* Dark outline on scalloped */}
            <Path d={mainBorderPath}
              stroke={isDarkMode ? '#0f172a' : '#1e293b'}
              strokeWidth={0.5 * scale}
              fill="none" opacity={0.2} />
          </>
        ) : (
          <SvgCircle cx={cx} cy={cy} r={borderR}
            stroke={`url(#${gradId})`}
            strokeWidth={def.borderWidth * scale}
            fill={c.border} />
        )}

        {/* ── Layer 6: Dark inner outline (contrast) ── */}
        <SvgCircle cx={cx} cy={cy}
          r={borderR - def.borderWidth * scale / 2 - 0.3}
          stroke={isDarkMode ? '#0f172a' : '#1e293b'}
          strokeWidth={0.5 * scale}
          fill="none" opacity={0.15} />

        {/* ── Shimmer sheen — bright arc sweeping the ring (Aurora tier) ── */}
        {showDecor && def.shimmer && (
          <Path
            d={`M ${cx} ${cy - borderR} A ${borderR} ${borderR} 0 0 1 ${(cx + borderR * 0.9).toFixed(2)} ${(cy - borderR * 0.42).toFixed(2)}`}
            stroke="#ffffff" strokeWidth={def.borderWidth * scale} fill="none"
            opacity={0.8} strokeLinecap="round" />
        )}

        {/* ── Layer 7: Inner white highlight shimmer ── */}
        <SvgCircle cx={cx} cy={cy} r={innerR + 1.5 * scale}
          stroke="#ffffff"
          strokeWidth={0.5 * scale}
          fill="none" opacity={isDarkMode ? 0.08 : 0.2} />

        {/* ── Layer 8: Decorative elements (hero avatars only) ── */}
        {renderDecorations({
          decorations: activeDecor,
          cx, cy,
          avatarR,
          borderR: outerR + 1,
          colors: borderColors.length > 0 ? borderColors : [primaryColor],
          gradId,
          isDark: isDarkMode,
          scale,
          decorScale: def.decorScale || 1,
        })}

        {/* ── Layer 9: Avatar image ── */}
        {avatarUri ? (
          <SvgImage
            href={{ uri: avatarUri }}
            x={cx - innerR}
            y={cy - innerR}
            width={innerR * 2}
            height={innerR * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        ) : (
          <SvgCircle cx={cx} cy={cy} r={innerR}
            fill={isDarkMode ? '#334155' : '#cbd5e1'} />
        )}
      </Svg>

      {/* Online indicator */}
      {showOnline && (
        <View style={{
          position: 'absolute',
          bottom: extraPad * 0.3, right: extraPad * 0.3,
          width: Math.max(8, avatarSize * 0.2),
          height: Math.max(8, avatarSize * 0.2),
          borderRadius: Math.max(4, avatarSize * 0.1),
          backgroundColor: isOnline ? '#22c55e' : '#94a3b8',
          borderWidth: Math.max(1, avatarSize * 0.03),
          borderColor: c.bg,
          zIndex: 11,
        }} />
      )}
    </View>
  );
};

export default React.memo(FramedAvatar);
