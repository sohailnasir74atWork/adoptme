import { getThemeColors } from '../../Helper/themeColors';
/**
 * FramedAvatar.jsx — Shape-Based Profile Frames
 * 📅 2026-03-13: The avatar SHAPE changes per frame tier.
 *
 * Instead of decorating around a circle, each tier cuts the avatar
 * into a unique shape using SVG ClipPath:
 *   Common    → Circle (thick colored border)
 *   Uncommon  → Squircle (iOS-style rounded square)
 *   Rare      → Hexagon
 *   Legendary → Shield/Badge
 *   Exclusive → Star
 *
 * The shape IS the frame. Instantly recognizable at any size.
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
  Stop,
  G,
} from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';
import SafeLottieView from '../../../Code/Helper/SafeLottieView';

// ── Lottie frame tiers (3 stages, least → most premium) ──
const LOTTIE_TIER = {
  1: require('../../../assets/lottie/frame/1st stage.json'),
  2: require('../../../assets/lottie/frame/2nd stage.json'),
  3: require('../../../assets/lottie/frame/3rd stage.json'),
};

// ════════════════════════════════════════════════════════════
//  SHAPE PATH GENERATORS
// ════════════════════════════════════════════════════════════

/** Circle path */
const circlePath = (cx, cy, r, segments = 64) => {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
};

/** Squircle (superellipse / iOS-style rounded square) */
const squirclePath = (cx, cy, size, n = 4) => {
  const pts = [];
  const half = size / 2;
  const segments = 80;
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const x = cx + Math.sign(cosT) * half * Math.pow(Math.abs(cosT), 2 / n);
    const y = cy + Math.sign(sinT) * half * Math.pow(Math.abs(sinT), 2 / n);
    pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
};

/** Hexagon */
const hexPath = (cx, cy, r) => {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI / 3) - Math.PI / 6; // flat-top hex
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')} Z`;
};

/** Rounded hexagon (smooth corners) */
const roundedHexPath = (cx, cy, r, cornerRadius = 4) => {
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI / 3) - Math.PI / 6;
    vertices.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    });
  }
  // Build path with quadratic curves at corners
  let d = '';
  for (let i = 0; i < 6; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % 6];
    const prev = vertices[(i + 5) % 6];

    // Direction from curr to next and curr to prev
    const toNext = { x: next.x - curr.x, y: next.y - curr.y };
    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
    const lenN = Math.sqrt(toNext.x * toNext.x + toNext.y * toNext.y);
    const lenP = Math.sqrt(toPrev.x * toPrev.x + toPrev.y * toPrev.y);

    const cr = Math.min(cornerRadius, lenN * 0.35, lenP * 0.35);

    const startX = curr.x + (toPrev.x / lenP) * cr;
    const startY = curr.y + (toPrev.y / lenP) * cr;
    const endX = curr.x + (toNext.x / lenN) * cr;
    const endY = curr.y + (toNext.y / lenN) * cr;

    if (i === 0) {
      d += `M ${startX.toFixed(2)} ${startY.toFixed(2)} `;
    } else {
      d += `L ${startX.toFixed(2)} ${startY.toFixed(2)} `;
    }
    d += `Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)} `;
  }
  d += 'Z';
  return d;
};

/** Shield / badge shape */
const shieldPath = (cx, cy, w, h) => {
  const hw = w / 2;
  const hh = h / 2;
  return `M ${cx} ${cy - hh}
    Q ${cx + hw * 0.4} ${cy - hh * 0.95} ${cx + hw} ${cy - hh * 0.6}
    L ${cx + hw} ${cy + hh * 0.1}
    Q ${cx + hw} ${cy + hh * 0.5} ${cx} ${cy + hh}
    Q ${cx - hw} ${cy + hh * 0.5} ${cx - hw} ${cy + hh * 0.1}
    L ${cx - hw} ${cy - hh * 0.6}
    Q ${cx - hw * 0.4} ${cy - hh * 0.95} ${cx} ${cy - hh} Z`;
};

/** Rounded star shape (soft star, like a sticker) */
const softStarPath = (cx, cy, outerR, innerR, points = 5) => {
  const pts = [];
  const total = points * 2;
  const cornerFactor = 0.85;
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push({
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    });
  }
  // Build with smooth curves
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const mx = (prev.x + curr.x) / 2;
    const my = (prev.y + curr.y) / 2;
    d += ` Q ${(prev.x * (1 - cornerFactor) + curr.x * cornerFactor).toFixed(2)} ${(prev.y * (1 - cornerFactor) + curr.y * cornerFactor).toFixed(2)} ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
};

// ════════════════════════════════════════════════════════════
//  FRAME DEFINITIONS — each maps to a unique shape
// ════════════════════════════════════════════════════════════
const FRAME_DEFS = {
  // ═══ COMMON — circle, thin accent border, no Lottie ═══
  pastel_ring: {
    shape: 'circle',
    borderWidth: 2, gap: 1.5,
    glowRadius: 0,
  },

  // ═══ UNCOMMON — squircle, SVG-rendered with colored border + glow ═══
  fire_ring: {
    shape: 'squircle',
    borderWidth: 2.5, gap: 2,
    glowRadius: 4, glowOpacity: 0.25,
  },
  frost_crystal: {
    shape: 'squircle',
    borderWidth: 2.5, gap: 2,
    glowRadius: 4, glowOpacity: 0.25,
  },
  ocean_wave: {
    shape: 'squircle',
    borderWidth: 2.5, gap: 2,
    glowRadius: 4, glowOpacity: 0.25,
  },
  butterfly_wings: {
    shape: 'squircle',
    borderWidth: 2.5, gap: 2,
    glowRadius: 5, glowOpacity: 0.3,
  },

  // ═══ RARE — hexagon + Lottie tier 2 ═══
  diamond: {
    shape: 'hexagon',
    borderWidth: 2.5, gap: 2,
    glowRadius: 6, glowOpacity: 0.35,
    lottie: 2,
  },
  neon_unicorn: {
    shape: 'hexagon',
    borderWidth: 3, gap: 2,
    doubleBorder: true,
    glowRadius: 8, glowOpacity: 0.4,
    lottie: 2,
  },
  cherry_blossom: {
    shape: 'hexagon',
    borderWidth: 2.5, gap: 2,
    glowRadius: 6, glowOpacity: 0.35,
    lottie: 2,
  },
  cotton_cloud: {
    shape: 'hexagon',
    borderWidth: 2.5, gap: 2,
    doubleBorder: true,
    glowRadius: 6, glowOpacity: 0.35,
    lottie: 2,
  },

  // ═══ LEGENDARY — shield + Lottie tier 3 ═══
  rainbow_glow: {
    shape: 'shield',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 8, glowOpacity: 0.45,
    lottie: 3,
  },
  starlight_princess: {
    shape: 'shield',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 8, glowOpacity: 0.45,
    lottie: 3,
  },
  royal_crown: {
    shape: 'shield',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 10, glowOpacity: 0.45,
    lottie: 3,
  },
  neon_kawaii: {
    shape: 'shield',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 8, glowOpacity: 0.5,
    lottie: 3,
  },

  // ═══ EXCLUSIVE — star + Lottie tier 3 ═══
  crystal_heart: {
    shape: 'star',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 10, glowOpacity: 0.55,
    lottie: 3,
  },
  holographic: {
    shape: 'star',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 12, glowOpacity: 0.6,
    lottie: 3,
  },

  // ═══ LEVEL REWARD FRAMES — Lottie tier 3 ═══
  sparkle: {
    shape: 'shield',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 8, glowOpacity: 0.45,
    lottie: 3,
  },
  tradeBorder: {
    shape: 'shield',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 8, glowOpacity: 0.45,
    lottie: 3,
  },
  animatedFrame: {
    shape: 'star',
    borderWidth: 3, gap: 2.5,
    doubleBorder: true,
    glowRadius: 10, glowOpacity: 0.55,
    lottie: 3,
  },
};

const DEFAULT_DEF = {
  shape: 'circle', borderWidth: 2, gap: 1.5, glowRadius: 0,
};

// ════════════════════════════════════════════════════════════
//  GET SHAPE PATH for a given shape + size
// ════════════════════════════════════════════════════════════
const getShapePath = (shape, cx, cy, size) => {
  const half = size / 2;
  switch (shape) {
    case 'squircle':
      return squirclePath(cx, cy, size, 5);
    case 'hexagon':
      return roundedHexPath(cx, cy, half, size * 0.12);
    case 'shield':
      return shieldPath(cx, cy, size, size * 1.08);
    case 'star':
      return softStarPath(cx, cy, half, half * 0.72, 6);
    case 'circle':
    default:
      return circlePath(cx, cy, half);
  }
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
}) => {
  const c = getThemeColors(isDarkMode);
  const def = frame?.id ? (FRAME_DEFS[frame.id] || DEFAULT_DEF) : null;
  const borderColors = frame?.borderColors || [];
  const glowColor = frame?.glowColor || null;
  const primaryColor = borderColors[0] || '#94a3b8';
  const secondaryColor = borderColors[1] || primaryColor;

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

  // ── Framed avatar ──
  const totalPadding = def.gap + def.borderWidth;
  // Shield/star shapes need more room
  const sizeMultiplier = def.shape === 'shield' ? 1.12 : def.shape === 'star' ? 1.15 : 1;
  const svgSize = (avatarSize + totalPadding * 2) * sizeMultiplier;
  const cx = svgSize / 2;
  const cy = svgSize / 2;

  // Inner clip size (for avatar image)
  const innerSize = avatarSize - 2;
  // Border shape size (slightly larger than avatar)
  const borderSize = avatarSize + def.gap * 2;
  // Outer ring (for double border)
  const outerSize = borderSize + def.borderWidth * 2 + 2;

  const innerPath = getShapePath(def.shape, cx, cy, innerSize);
  const borderPath = getShapePath(def.shape, cx, cy, borderSize);
  const outerPath = def.doubleBorder ? getShapePath(def.shape, cx, cy, outerSize) : null;

  const showOnline = isOnline !== undefined && avatarSize >= 40;

  // ── Lottie overlay (only for avatarSize >= 20 to avoid perf issues in extremely tiny views) ──
  const lottieSource = (def.lottie && avatarSize >= 20) ? LOTTIE_TIER[def.lottie] : null;

  // ══════════════════════════════════════════════════
  //  LOTTIE FRAME — simple circular avatar + Lottie overlay, NO SVG
  // ══════════════════════════════════════════════════
  if (lottieSource) {
    const lottieSize = avatarSize * 1.65;
    return (
      <View style={{ position: 'relative', width: lottieSize, height: lottieSize, alignItems: 'center', justifyContent: 'center' }}>
        {/* Lottie animation — the frame itself */}
        <SafeLottieView
          source={lottieSource}
          autoPlay
          loop
          resizeMode="contain"
          style={{
            position: 'absolute',
            width: lottieSize,
            height: lottieSize,
          }}
        />

        {/* Colored glow ring — unique per frame */}
        {glowColor && (
          <View style={{
            position: 'absolute',
            width: avatarSize + 6, height: avatarSize + 6,
            borderRadius: (avatarSize + 6) / 2,
            borderWidth: 1.5,
            borderColor: glowColor,
            opacity: 0.5,
          }} />
        )}

        {/* Circular avatar with colored border ring — unique per frame */}
        <View style={{
          width: avatarSize + 4, height: avatarSize + 4,
          borderRadius: (avatarSize + 4) / 2,
          borderWidth: 2,
          borderColor: primaryColor,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0',
        }}>
          <View style={{
            width: avatarSize, height: avatarSize,
            borderRadius: avatarSize / 2,
            overflow: 'hidden',
          }}>
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
              />
            ) : null}
          </View>
        </View>

        {/* Online indicator */}
        {showOnline && (
          <View style={{
            position: 'absolute',
            bottom: 0, right: lottieSize * 0.15,
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
  }

  // ══════════════════════════════════════════════════
  //  SVG FRAME — standard shape-based frame (no Lottie)
  // ══════════════════════════════════════════════════
  return (
    <View style={{ position: 'relative' }}>
      <Svg width={svgSize} height={svgSize}>
        {/* Defs — clip path + glow */}
        <Defs>
          <ClipPath id={`clip-${frame.id}`}>
            <Path d={innerPath} />
          </ClipPath>
          {glowColor && def.glowRadius > 0 && (
            <RadialGradient id={`glow-${frame.id}`} cx="50%" cy="50%" r="50%">
              <Stop offset="50%" stopColor={glowColor} stopOpacity={(def.glowOpacity || 0.4) * 0.8} />
              <Stop offset="100%" stopColor={glowColor} stopOpacity={0} />
            </RadialGradient>
          )}
        </Defs>

        {/* Glow */}
        {glowColor && def.glowRadius > 0 && (
          <SvgCircle
            cx={cx} cy={cy}
            r={svgSize / 2 - 1}
            fill={`url(#glow-${frame.id})`}
          />
        )}

        {/* Outer border (double border for rare+) */}
        {def.doubleBorder && outerPath && (
          <Path
            d={outerPath}
            stroke={secondaryColor}
            strokeWidth={1.5}
            fill="none"
            opacity={0.4}
          />
        )}

        {/* Main colored border */}
        <Path
          d={borderPath}
          stroke={primaryColor}
          strokeWidth={def.borderWidth}
          fill={c.border}
          strokeLinejoin="round"
        />

        {/* Inner colored accent line */}
        {borderColors.length > 1 && (
          <Path
            d={getShapePath(def.shape, cx, cy, innerSize + 2)}
            stroke={secondaryColor}
            strokeWidth={1.5}
            fill="none"
            opacity={0.6}
          />
        )}

        {/* Avatar image — clipped to shape */}
        {avatarUri && (
          <SvgImage
            href={{ uri: avatarUri }}
            x={cx - innerSize / 2}
            y={cy - innerSize / 2}
            width={innerSize}
            height={innerSize}
            clipPath={`url(#clip-${frame.id})`}
            preserveAspectRatio="xMidYMid slice"
          />
        )}

        {/* Fallback if no avatar */}
        {!avatarUri && (
          <Path d={innerPath} fill={isDarkMode ? '#334155' : '#cbd5e1'} />
        )}
      </Svg>

      {/* Online indicator */}
      {showOnline && (
        <View style={{
          position: 'absolute',
          bottom: 0, right: 0,
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
