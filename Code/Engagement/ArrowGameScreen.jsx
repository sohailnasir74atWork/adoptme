import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Pressable, useWindowDimensions, Animated, Easing,
} from 'react-native';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';

import Confetti from '../Design/Confetti';
import { useNavigation } from '@react-navigation/native';
import { initGameSounds, playWoosh, playPop, startAmbient, stopAmbient, setSoundEnabled, releaseGameSounds } from '../Helper/GameSoundService';

// Fallback tokens from sailer-piece
const colors = { bg: '#0F172A', card: '#1E293B', text: '#F8FAFC', success: '#10B981', dev: '#94A3B8' };
const gradients = { primary: ['#3B82F6', '#6366F1'], bg: ['#0F172A', '#1E293B'] };
const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
const typography = {
  header: { fontSize: 24, fontWeight: 'bold' },
  fontFamily: { bold: 'System', medium: 'System', regular: 'System' },
  sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 20 },
};
const borderRadius = { md: 12, lg: 16, full: 9999 };
const shadow = { sm: {} };

// Real ad & pro implementations
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
const BannerAdView = () => <BannerAdComponent adType="banner" />;
const showInterstitial = () => {
  InterstitialAdManager.showAd();
};
const useProStatus = () => {
  const { localState } = useLocalState();
  return { isPro: !!localState?.isPro };
};

// Game-local persistence (level progress, sound prefs, stars)
let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'arrow-game' });
} catch (e) {
  storage = { getString: () => null, getNumber: () => null, getBoolean: () => null, set: () => {} };
}
const LVL_STORE_KEY = 'arrow_game_level';

const ROWS = 24;
const COLS = 18;
const GRID_MARGIN = spacing.sm;
const GRID_PAD = 5; // inner padding so cells don't touch the grid boundary
// Fixed-height chrome pieces; variable pieces (safe-area insets, banner, dev nav)
// are folded in at render time so the grid expands on Pro / small-insets devices.
const HEADER_CONTENT_H = 52;   // Plain header: paddingVertical 6 + minHeight 40
const STATUS_ROW_H = 28;       // Hearts row (22pt icon + spacing)
const HINT_LINE_H = 25;        // Hint text line (marginTop + xs font)
const GAME_AREA_PAD_TOP = spacing.md; // gameArea paddingTop
const GRID_MARGIN_TOP = spacing.lg;   // grid marginTop
const BANNER_H = 60;           // Anchored adaptive banner + its padding
const DEV_NAV_H = 52;          // DEV level-switcher footer
const CHROME_BUFFER = 8;       // safety so rounding/font differences never clip

const DIR_VEC = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
const DIR_OPP = { U: 'D', D: 'U', L: 'R', R: 'L' };

const ARROW_COLORS = [
    ['#06B6D4', '#3B82F6'],
    ['#F472B6', '#EC4899'],
    ['#FBBF24', '#F59E0B'],
    ['#34D399', '#10B981'],
    ['#A78BFA', '#7C3AED'],
    ['#FB923C', '#EF4444'],
    ['#60A5FA', '#2563EB'],
    ['#F87171', '#DC2626'],
];

// ── Levels ───────────────────────────────────────────────────────────
// Each arrow: { r, c, dir, tail }
//   r,c  = HEAD position
//   dir  = direction the head FIRES (U|D|L|R)
//   tail = string of direction chars tracing the body BEHIND the head,
//          one char per cell. e.g. 'LUU' = tail steps left, up, up.
//          Can bend freely: L-shapes, zigzags, spirals, etc.
//          Each step must stay in-grid and not overlap an earlier tail cell.
//
const LEVELS = [
    // 1 — 3 arrows, 22 cells
    {
        arrows: [
            { r: 4,  c: 8,  dir: 'R', tail: 'DDDDDDDDD' },        // 10-cell column blocker
            { r: 16, c: 8,  dir: 'U', tail: 'DDDLL' },             // blocked by A0
            { r: 14, c: 3,  dir: 'R', tail: 'DDLLL' },             // independent
        ],
        walls: [],
    },
    // 2 — 3 arrows, 25 cells
    {
        arrows: [
            { r: 5,  c: 3,  dir: 'R', tail: 'LLDDDLDDRURD' },     // U-shape (13 cells)
            { r: 18, c: 14, dir: 'U', tail: 'DDDRRR' },            // L-shape (7 cells)
            { r: 12, c: 9,  dir: 'L', tail: 'RRRR' },              // straight (5 cells)
        ],
        walls: [],
    },
    // 3 — 4 arrows, 43 cells
    {
        arrows: [
            { r: 2,  c: 6,  dir: 'R', tail: 'DDLDLLDRDLDRRR' },    // S-curve (15 cells)
            { r: 14, c: 8,  dir: 'U', tail: 'DLLLLUURRR' },        // blocked by A0
            { r: 20, c: 8,  dir: 'U', tail: 'DRRRRUUULL' },        // blocked by A1
            { r: 10, c: 14, dir: 'D', tail: 'UUULL' },             // independent
        ],
        walls: [],
    },
    // 4 — 5 arrows, 48 cells + 4 walls
    {
        arrows: [
            { r: 10, c: 8,  dir: 'U', tail: 'DDDDDRRRRRRUUUUU' },  // giant L-shape
            { r: 18, c: 8,  dir: 'U', tail: 'DRRRDDLL' },          // blocked by A0
            { r: 10, c: 16, dir: 'L', tail: 'DDDDR' },             // blocked by A0
            { r: 3,  c: 3,  dir: 'R', tail: 'DDDDDLLL' },          // blocked by A4
            { r: 3,  c: 15, dir: 'D', tail: 'UUULLL' },            // clear (start here)
        ],
        walls: [[8, 6], [8, 7], [8, 9], [8, 10]],
    },
    // 5 — 6 arrows, 58 cells
    {
        arrows: [
            { r: 0,  c: 2,  dir: 'D', tail: 'RRDDRRURDRR' },
            { r: 21, c: 16, dir: 'L', tail: 'DRDLL' },
            { r: 17, c: 17, dir: 'U', tail: 'LDLULDDDDDRU' },
            { r: 15, c: 3,  dir: 'R', tail: 'UURUULUURU' },
            { r: 13, c: 2,  dir: 'D', tail: 'LLURUURU' },
            { r: 7,  c: 12, dir: 'L', tail: 'DDDDRD' },
        ],
        walls: [],
    },
    // 6 — 7 arrows, 69 cells
    {
        arrows: [
            { r: 0,  c: 2,  dir: 'L', tail: 'RDLLDLDDDDRU' },
            { r: 12, c: 5,  dir: 'L', tail: 'RRUULULULUUURR' },
            { r: 22, c: 4,  dir: 'L', tail: 'DRURUL' },
            { r: 19, c: 4,  dir: 'D', tail: 'RRRRULUUU' },
            { r: 12, c: 9,  dir: 'D', tail: 'ULDDDD' },
            { r: 12, c: 15, dir: 'R', tail: 'LUUULLURR' },
            { r: 7,  c: 12, dir: 'L', tail: 'RRURDD' },
        ],
        walls: [],
    },
    // 7 — 8 arrows, 60 cells
    {
        arrows: [
            { r:  1, c:  3, dir: 'R', tail: 'DDDRRUUL' },
            { r:  4, c: 14, dir: 'L', tail: 'DDRRUU' },
            { r:  8, c:  8, dir: 'U', tail: 'DLLDRR' },
            { r: 10, c:  1, dir: 'R', tail: 'DRRDDDD' },
            { r: 15, c:  6, dir: 'D', tail: 'UURRUL' },
            { r: 18, c: 13, dir: 'U', tail: 'DDLLDRR' },
            { r: 21, c:  2, dir: 'R', tail: 'UURRDR' },
            { r: 22, c: 14, dir: 'L', tail: 'URRULL' },
        ],
        walls: [],
    },
    // 8 — 8 arrows, 75 cells
    {
        arrows: [
            { r:  0, c:  2, dir: 'D', tail: 'RDRRDRUURRD' },
            { r: 21, c: 16, dir: 'L', tail: 'URDDL' },
            { r: 17, c: 17, dir: 'U', tail: 'LULLDDLLULDL' },
            { r: 15, c:  3, dir: 'R', tail: 'UURUULUURU' },
            { r: 13, c:  2, dir: 'D', tail: 'LLURUURU' },
            { r:  7, c: 12, dir: 'L', tail: 'RRUULD' },
            { r: 12, c:  9, dir: 'D', tail: 'ULLURR' },
            { r: 12, c: 15, dir: 'R', tail: 'LUUULLURR' },
        ],
        walls: [],
    },
    // 9 — 8 arrows, 76 cells + 6 walls
    {
        arrows: [
            { r: 0,  c: 2,  dir: 'U', tail: 'LDRDDDLUU' },
            { r: 15, c: 15, dir: 'U', tail: 'RDDLLD' },
            { r: 0,  c: 12, dir: 'U', tail: 'DRURRDDDRR' },
            { r: 3,  c: 8,  dir: 'L', tail: 'RULURULLLD' },
            { r: 7,  c: 12, dir: 'L', tail: 'URUUL' },
            { r: 21, c: 14, dir: 'D', tail: 'LLULLLLUR' },
            { r: 17, c: 12, dir: 'D', tail: 'LLURURRUR' },
            { r: 20, c: 13, dir: 'U', tail: 'RURURRUUUU' },
        ],
        walls: [[8, 5], [8, 6], [8, 7], [8, 9], [8, 10], [8, 11]],
    },
    // 10 — 9 arrows, 83 cells
    {
        arrows: [
            { r:  1, c:  5, dir: 'D', tail: 'RURRDD' },
            { r: 18, c: 16, dir: 'D', tail: 'UUULUUL' },
            { r:  7, c:  5, dir: 'R', tail: 'DLLUURULL' },
            { r:  2, c:  4, dir: 'R', tail: 'ULLURRR' },
            { r: 20, c:  5, dir: 'R', tail: 'ULUUUURRURDRU' },
            { r:  1, c: 15, dir: 'U', tail: 'DRDDLLUR' },
            { r: 11, c: 13, dir: 'L', tail: 'RUULDLU' },
            { r: 14, c: 10, dir: 'U', tail: 'RRRULUR' },
            { r:  7, c: 12, dir: 'U', tail: 'RRRURDRDLD' },
        ],
        walls: [],
    },
    // 11 — 9 arrows, 85 cells
    {
        arrows: [
            { r: 0,  c: 4,  dir: 'R', tail: 'LLDRDRUR' },
            { r: 12, c: 17, dir: 'D', tail: 'UUUUUUUL' },
            { r: 14, c: 12, dir: 'U', tail: 'DDRUR' },
            { r: 13, c: 0,  dir: 'L', tail: 'RRULLURRUUL' },
            { r: 21, c: 12, dir: 'R', tail: 'URRUURULLLDR' },
            { r: 14, c: 13, dir: 'R', tail: 'UUURDDRR' },
            { r: 15, c: 2,  dir: 'U', tail: 'RUUURDRD' },
            { r: 14, c: 0,  dir: 'U', tail: 'RDDLDR' },
            { r: 22, c: 6,  dir: 'D', tail: 'RDRRRRRRUR' },
        ],
        walls: [],
    },
    // 12 — 10 arrows, 67 cells + 4 walls
    {
        arrows: [
            { r:  1, c:  2, dir: 'R', tail: 'DDRRDR' },
            { r:  3, c: 14, dir: 'L', tail: 'DDLDR' },
            { r:  5, c:  1, dir: 'D', tail: 'URRDDR' },
            { r:  4, c: 12, dir: 'R', tail: 'DDLLDD' },
            { r:  8, c: 17, dir: 'L', tail: 'UULLDR' },
            { r: 13, c:  2, dir: 'D', tail: 'URRDDR' },
            { r: 14, c:  9, dir: 'L', tail: 'UULLDR' },
            { r: 19, c:  7, dir: 'U', tail: 'DRRDDL' },
            { r: 21, c: 11, dir: 'L', tail: 'UURRDR' },
            { r: 23, c:  3, dir: 'R', tail: 'UULL' },
        ],
        walls: [[11, 5], [11, 6], [18, 12], [18, 13]],
    },
    // 13 — 10 arrows, 73 cells
    {
        arrows: [
            { r:  2, c:  2, dir: 'R', tail: 'DDDRRUUL' },
            { r:  1, c: 11, dir: 'D', tail: 'URRRDD' },
            { r:  5, c: 16, dir: 'L', tail: 'UULLDR' },
            { r:  7, c:  7, dir: 'U', tail: 'DDRRUUL' },
            { r:  9, c:  2, dir: 'R', tail: 'DDLLDR' },
            { r: 13, c:  5, dir: 'D', tail: 'URRUULL' },
            { r: 15, c: 15, dir: 'U', tail: 'DDLLUR' },
            { r: 18, c:  8, dir: 'L', tail: 'DDRRRU' },
            { r: 20, c:  1, dir: 'R', tail: 'DRDDLU' },
            { r: 23, c: 14, dir: 'L', tail: 'UURRD' },
        ],
        walls: [],
    },
    // 14 — 10 arrows, 77 cells
    {
        arrows: [
            { r:  0, c:  7, dir: 'L', tail: 'RRRDR' },
            { r:  6, c: 14, dir: 'L', tail: 'DRUR' },
            { r: 19, c:  1, dir: 'L', tail: 'DDRDRRU' },
            { r: 16, c: 16, dir: 'U', tail: 'RDLD' },
            { r: 15, c: 12, dir: 'U', tail: 'RRUURRUURU' },
            { r: 22, c: 15, dir: 'U', tail: 'LDLUUL' },
            { r: 17, c: 13, dir: 'U', tail: 'RRDDLLDR' },
            { r:  3, c: 15, dir: 'R', tail: 'DRRDLLLUL' },
            { r:  2, c:  7, dir: 'U', tail: 'DDRDLDR' },
            { r: 15, c: 10, dir: 'L', tail: 'DDRRURR' },
        ],
        walls: [],
    },
    // 15 — 10 arrows, 95 cells + 3 walls
    {
        arrows: [
            { r:  0, c:  4, dir: 'R', tail: 'DRRRDLDD' },
            { r: 12, c: 17, dir: 'D', tail: 'UUUUUUUL' },
            { r: 14, c: 12, dir: 'U', tail: 'DDRUR' },
            { r: 13, c:  0, dir: 'L', tail: 'RRULLURRUUL' },
            { r: 21, c: 12, dir: 'R', tail: 'DRRRRDLLLLLU' },
            { r: 14, c: 13, dir: 'R', tail: 'ULULLLLU' },
            { r: 15, c:  2, dir: 'U', tail: 'RUUURDRD' },
            { r: 14, c:  0, dir: 'U', tail: 'RDDLDR' },
            { r: 22, c:  6, dir: 'D', tail: 'UULUURUUUL' },
            { r:  8, c:  6, dir: 'R', tail: 'LLDRRRDLL' },
        ],
        walls: [[5, 8], [5, 9], [5, 10]],
    },
    // 16 — 11 arrows, 74 cells
    {
        arrows: [
            { r:  0, c:  2, dir: 'D', tail: 'LLDRDLDRD' },
            { r:  1, c: 10, dir: 'R', tail: 'DDLLDR' },
            { r:  7, c:  9, dir: 'L', tail: 'DDRRDR' },
            { r:  8, c: 15, dir: 'D', tail: 'ULLUR' },
            { r: 10, c:  4, dir: 'D', tail: 'URRDDL' },
            { r: 11, c: 11, dir: 'U', tail: 'DRRDDL' },
            { r: 15, c:  7, dir: 'R', tail: 'UULLDL' },
            { r: 19, c:  9, dir: 'L', tail: 'UURRDR' },
            { r: 21, c:  5, dir: 'D', tail: 'URRUL' },
            { r: 22, c: 14, dir: 'R', tail: 'UULLU' },
            { r: 23, c: 10, dir: 'L', tail: 'UUR' },
        ],
        walls: [],
    },
    // 17 — 11 arrows, 77 cells
    {
        arrows: [
            { r:  0, c:  3, dir: 'R', tail: 'DDDRRRU' },
            { r:  3, c: 10, dir: 'U', tail: 'DDRRDD' },
            { r:  6, c:  1, dir: 'D', tail: 'URRDDR' },
            { r:  7, c:  7, dir: 'L', tail: 'DDRRRU' },
            { r: 10, c:  4, dir: 'R', tail: 'UULLDL' },
            { r: 11, c: 11, dir: 'U', tail: 'DRRDDL' },
            { r: 16, c:  9, dir: 'L', tail: 'UURRDR' },
            { r: 17, c: 13, dir: 'D', tail: 'URRULL' },
            { r: 20, c:  5, dir: 'U', tail: 'DDLLDR' },
            { r: 21, c: 14, dir: 'R', tail: 'UULLDR' },
            { r: 23, c:  1, dir: 'R', tail: 'UURRU' },
        ],
        walls: [],
    },
    // 18 — 11 arrows, 103 cells
    {
        arrows: [
            { r:  0, c:  4, dir: 'R', tail: 'LLLDDDDR' },
            { r: 12, c: 17, dir: 'D', tail: 'UUUUUUUL' },
            { r: 14, c: 12, dir: 'U', tail: 'DDRUR' },
            { r: 13, c:  0, dir: 'L', tail: 'RRULLURRUUL' },
            { r: 21, c: 12, dir: 'R', tail: 'URRRULLLLDLD' },
            { r: 14, c: 13, dir: 'R', tail: 'ULLLULLU' },
            { r: 15, c:  2, dir: 'U', tail: 'RUUURDRD' },
            { r: 14, c:  0, dir: 'U', tail: 'RDDLDR' },
            { r: 22, c:  6, dir: 'D', tail: 'LDLLURULLU' },
            { r:  8, c:  6, dir: 'R', tail: 'ULLDRDRDD' },
            { r:  5, c:  0, dir: 'R', tail: 'DDDRURU' },
        ],
        walls: [],
    },
    // 19 — 12 arrows, 79 cells + 4 walls
    {
        arrows: [
            { r:  1, c: 10, dir: 'D', tail: 'URRRD' },
            { r:  2, c: 16, dir: 'L', tail: 'DDLDR' },
            { r:  5, c:  8, dir: 'U', tail: 'DDRRU' },
            { r:  4, c: 13, dir: 'R', tail: 'DDLLUL' },
            { r:  8, c: 11, dir: 'L', tail: 'DDRRUR' },
            { r: 10, c:  5, dir: 'D', tail: 'URRUUL' },
            { r: 11, c: 14, dir: 'U', tail: 'DDLDR' },
            { r: 13, c:  1, dir: 'R', tail: 'DRDLDR' },
            { r: 14, c: 12, dir: 'R', tail: 'UULLDR' },
            { r: 16, c: 16, dir: 'L', tail: 'DDLLUR' },
            { r: 21, c: 15, dir: 'L', tail: 'UURRD' },
            { r: 23, c:  9, dir: 'L', tail: 'UURRUL' },
        ],
        walls: [[6, 6], [6, 7], [18, 7], [18, 8]],
    },
    // 20 — 12 arrows, 87 cells + 6 walls
    {
        arrows: [
            { r: 0,  c: 2,  dir: 'L', tail: 'RRRDLLLL' },
            { r: 18, c: 11, dir: 'L', tail: 'URRU' },
            { r: 7,  c: 17, dir: 'R', tail: 'LLULUL' },
            { r: 0,  c: 7,  dir: 'R', tail: 'LDRD' },
            { r: 13, c: 2,  dir: 'L', tail: 'RRDRDRRDD' },
            { r: 20, c: 16, dir: 'R', tail: 'LDLDRRU' },
            { r: 9,  c: 4,  dir: 'R', tail: 'LLULLUUU' },
            { r: 12, c: 9,  dir: 'L', tail: 'RRRULUL' },
            { r: 17, c: 17, dir: 'L', tail: 'UUULDL' },
            { r: 12, c: 13, dir: 'R', tail: 'URRUL' },
            { r: 13, c: 0,  dir: 'L', tail: 'URUUR' },
            { r: 22, c: 10, dir: 'R', tail: 'LDLULL' },
        ],
        walls: [[7, 4], [7, 5], [7, 6], [7, 11], [7, 12], [7, 13]],
    },
    // 21 — 12 arrows, 115 cells
    {
        arrows: [
            { r:  1, c:  9, dir: 'R', tail: 'DLLLDRRRRUR' },
            { r: 23, c:  6, dir: 'U', tail: 'LUULUR' },
            { r: 23, c: 15, dir: 'R', tail: 'LUURDRU' },
            { r: 15, c:  7, dir: 'L', tail: 'UURULURU' },
            { r: 17, c:  9, dir: 'L', tail: 'RUULLURURDR' },
            { r:  0, c: 13, dir: 'R', tail: 'DLDRRD' },
            { r:  1, c:  4, dir: 'U', tail: 'DDDLLDR' },
            { r:  7, c:  5, dir: 'L', tail: 'DRUUUU' },
            { r:  7, c: 17, dir: 'U', tail: 'LUULURUUULL' },
            { r: 10, c:  9, dir: 'D', tail: 'RURRRDRR' },
            { r:  5, c:  1, dir: 'D', tail: 'ULURRULLURU' },
            { r:  5, c:  9, dir: 'D', tail: 'RRURURDDRDR' },
        ],
        walls: [],
    },
    // 22 — 13 arrows, 83 cells + 4 walls
    {
        arrows: [
            { r:  1, c: 16, dir: 'L', tail: 'DDRDL' },
            { r:  4, c: 12, dir: 'U', tail: 'DRRDDL' },
            { r:  6, c:  0, dir: 'R', tail: 'DRDDDD' },
            { r:  7, c:  7, dir: 'R', tail: 'DDLLDL' },
            { r:  9, c: 11, dir: 'R', tail: 'DDLLDR' },
            { r: 11, c: 15, dir: 'L', tail: 'DDRRUU' },
            { r: 12, c:  6, dir: 'L', tail: 'UURDR' },
            { r: 16, c: 17, dir: 'L', tail: 'DDLLUR' },
            { r: 16, c:  5, dir: 'D', tail: 'URRDDL' },
            { r: 18, c:  2, dir: 'R', tail: 'DDRRU' },
            { r: 20, c: 14, dir: 'R', tail: 'DDLDR' },
            { r: 22, c: 11, dir: 'L', tail: 'UURRU' },
            { r: 23, c: 16, dir: 'L', tail: 'UUR' },
        ],
        walls: [[5, 8], [5, 9], [15, 0], [15, 1]],
    },
    // 23 — 13 arrows, 127 cells
    {
        arrows: [
            { r:  1, c:  9, dir: 'R', tail: 'DRDLDLDDDDR' },
            { r: 23, c:  6, dir: 'U', tail: 'LUULUR' },
            { r: 23, c: 15, dir: 'R', tail: 'LLLURUL' },
            { r: 15, c:  7, dir: 'L', tail: 'UURULURU' },
            { r: 17, c:  9, dir: 'L', tail: 'RURRUUULLUU' },
            { r:  0, c: 13, dir: 'R', tail: 'LDLULD' },
            { r:  1, c:  4, dir: 'U', tail: 'LDDDDDR' },
            { r:  7, c:  5, dir: 'L', tail: 'DRUUUU' },
            { r:  7, c: 17, dir: 'U', tail: 'LLLDLLLUURU' },
            { r: 10, c:  9, dir: 'D', tail: 'RURRRDRR' },
            { r:  5, c:  1, dir: 'D', tail: 'ULURRULLURU' },
            { r:  5, c:  9, dir: 'D', tail: 'RRURURDDRDR' },
            { r: 11, c: 16, dir: 'D', tail: 'RDDDDDDDDDD' },
        ],
        walls: [],
    },
    // 24 — 14 arrows, 127 cells
    {
        arrows: [
            { r: 0,  c: 4,  dir: 'R', tail: 'LLDRDRDR' },
            { r: 12, c: 17, dir: 'D', tail: 'UUUUUUUL' },
            { r: 14, c: 12, dir: 'U', tail: 'DDRUR' },
            { r: 13, c: 0,  dir: 'L', tail: 'RRULLURRUUL' },
            { r: 21, c: 12, dir: 'R', tail: 'URULULLDDLDD' },
            { r: 14, c: 13, dir: 'R', tail: 'ULLLURRU' },
            { r: 15, c: 2,  dir: 'U', tail: 'RUUURDRD' },
            { r: 14, c: 0,  dir: 'U', tail: 'RDDLDR' },
            { r: 22, c: 6,  dir: 'D', tail: 'UULULLLUUU' },
            { r: 8,  c: 6,  dir: 'R', tail: 'DLLDDRURR' },
            { r: 5,  c: 0,  dir: 'R', tail: 'DDDRURU' },
            { r: 17, c: 11, dir: 'U', tail: 'RRDRDDD' },
            { r: 18, c: 1,  dir: 'R', tail: 'DLDRDR' },
            { r: 2,  c: 2,  dir: 'L', tail: 'DDDRDRDR' },
        ],
        walls: [],
    },
    // 25 — 14 arrows, 136 cells
    {
        arrows: [
            { r:  1, c:  9, dir: 'R', tail: 'DDDLDLUULLU' },
            { r: 23, c:  6, dir: 'U', tail: 'LUULUR' },
            { r: 23, c: 15, dir: 'R', tail: 'LURRRUU' },
            { r: 15, c:  7, dir: 'L', tail: 'UURULURU' },
            { r: 17, c:  9, dir: 'L', tail: 'URDRRRDLLLL' },
            { r:  0, c: 13, dir: 'R', tail: 'LLLLLL' },
            { r:  1, c:  4, dir: 'U', tail: 'DDDRDDL' },
            { r:  7, c:  5, dir: 'L', tail: 'DRUUUU' },
            { r:  7, c: 17, dir: 'U', tail: 'LUUULURUUUL' },
            { r: 10, c:  9, dir: 'D', tail: 'RURRRDRR' },
            { r:  5, c:  1, dir: 'D', tail: 'ULURRULLURU' },
            { r:  5, c:  9, dir: 'D', tail: 'RRURURDDRDR' },
            { r: 11, c: 16, dir: 'D', tail: 'LDLLLLDDLUU' },
            { r: 16, c: 14, dir: 'L', tail: 'ULLURRUL' },
        ],
        walls: [],
    },
    // 26 — 15 arrows, 97 cells
    {
        arrows: [
            { r:  0, c:  1, dir: 'R', tail: 'DDRRDD' },
            { r:  1, c:  8, dir: 'L', tail: 'DDRRDR' },
            { r:  2, c: 15, dir: 'D', tail: 'ULLUR' },
            { r:  4, c:  4, dir: 'D', tail: 'URRUL' },
            { r:  4, c: 12, dir: 'U', tail: 'DDRRDL' },
            { r:  6, c:  0, dir: 'R', tail: 'URUURD' },
            { r:  7, c:  8, dir: 'R', tail: 'UULLDR' },
            { r:  9, c:  3, dir: 'D', tail: 'URRDDL' },
            { r: 10, c: 11, dir: 'L', tail: 'UURRDR' },
            { r: 13, c:  6, dir: 'R', tail: 'DDLDR' },
            { r: 15, c:  1, dir: 'U', tail: 'URURRU' },
            { r: 14, c: 16, dir: 'L', tail: 'DDR' },
            { r: 16, c:  9, dir: 'U', tail: 'DDRRU' },
            { r: 18, c:  4, dir: 'D', tail: 'URRDDL' },
            { r: 21, c: 14, dir: 'L', tail: 'DDRRU' },
        ],
        walls: [],
    },
    // 27 — 15 arrows, 144 cells
    {
        arrows: [
            { r:  0, c:  2, dir: 'U', tail: 'LDRDDDLUU' },
            { r: 15, c: 15, dir: 'U', tail: 'RDDLLD' },
            { r:  0, c: 12, dir: 'U', tail: 'DRURRDDDRR' },
            { r:  3, c:  8, dir: 'L', tail: 'RULURULLLD' },
            { r:  7, c: 12, dir: 'U', tail: 'DDLLL' },
            { r: 16, c:  9, dir: 'U', tail: 'LLLLLLLLU' },
            { r: 21, c: 14, dir: 'D', tail: 'LLULLLLUR' },
            { r: 17, c: 12, dir: 'D', tail: 'LLURURRUR' },
            { r: 20, c: 13, dir: 'U', tail: 'RURURRUUUU' },
            { r: 18, c:  1, dir: 'L', tail: 'RURDDDDR' },
            { r: 13, c:  2, dir: 'U', tail: 'RUURDDDDRU' },
            { r:  5, c:  2, dir: 'L', tail: 'DRRRRRRDDR' },
            { r: 20, c:  4, dir: 'U', tail: 'RRRDLLDLDR' },
            { r: 11, c: 14, dir: 'R', tail: 'LDLDRR' },
            { r:  9, c:  1, dir: 'D', tail: 'RURURDDR' },
        ],
        walls: [],
    },
    // 28 — 16 arrows, 150 cells
    {
        arrows: [
            { r:  0, c:  2, dir: 'U', tail: 'LDRDDDLUU' },
            { r: 15, c: 15, dir: 'U', tail: 'RDDLLD' },
            { r:  0, c: 12, dir: 'U', tail: 'DRURRDDDRR' },
            { r:  3, c:  8, dir: 'L', tail: 'RULURULLLD' },
            { r:  7, c: 12, dir: 'L', tail: 'URUUU' },
            { r: 16, c:  9, dir: 'U', tail: 'DDRDRRURU' },
            { r: 21, c: 14, dir: 'D', tail: 'LLULLLLUR' },
            { r: 17, c: 12, dir: 'U', tail: 'LLURURRUR' },
            { r: 20, c: 13, dir: 'U', tail: 'RRDDLDLLUR' },
            { r: 18, c:  1, dir: 'L', tail: 'RRDLLLDR' },
            { r: 13, c:  2, dir: 'U', tail: 'RUURDDDDRU' },
            { r:  5, c:  2, dir: 'L', tail: 'DRRRRRRDDR' },
            { r: 20, c:  4, dir: 'U', tail: 'RUUUURURRD' },
            { r: 11, c: 14, dir: 'R', tail: 'LDLULU' },
            { r:  9, c:  1, dir: 'D', tail: 'RURURDDR' },
            { r: 23, c: 11, dir: 'U', tail: 'LLUUR' },
        ],
        walls: [],
    },
    // 29 — 16 arrows, 150 cells
    {
        arrows: [
            { r:  0, c:  2, dir: 'U', tail: 'LDRDDDLUU' },
            { r: 15, c: 15, dir: 'U', tail: 'RDDLLD' },
            { r:  0, c: 12, dir: 'U', tail: 'DRURRDDDRR' },
            { r:  3, c:  8, dir: 'L', tail: 'RULURULLLD' },
            { r:  7, c: 12, dir: 'L', tail: 'ULLLU' },
            { r: 16, c:  9, dir: 'U', tail: 'LUUULDLUU' },
            { r: 21, c: 14, dir: 'D', tail: 'LLULLLLUR' },
            { r: 17, c: 12, dir: 'D', tail: 'LLURURRUR' },
            { r: 20, c: 13, dir: 'U', tail: 'RURURRUUUU' },
            { r: 18, c:  1, dir: 'L', tail: 'DRRULURU' },
            { r: 13, c:  2, dir: 'U', tail: 'RUURDDDDRU' },
            { r:  5, c:  2, dir: 'L', tail: 'DRRRRRRDDR' },
            { r: 20, c:  4, dir: 'U', tail: 'RRULUURURD' },
            { r: 11, c: 14, dir: 'R', tail: 'DRDDRU' },
            { r:  9, c:  1, dir: 'D', tail: 'RURURDDR' },
            { r: 23, c: 11, dir: 'U', tail: 'LULLD' },
        ],
        walls: [],
    },
    // 30 — 18 arrows, 175 cells
    {
        arrows: [
            { r:  1, c:  9, dir: 'R', tail: 'LDRRDDLULDL' },
            { r: 23, c:  6, dir: 'U', tail: 'LUULUR' },
            { r: 23, c: 15, dir: 'R', tail: 'URRULUL' },
            { r: 15, c:  7, dir: 'L', tail: 'UURULURU' },
            { r: 17, c:  9, dir: 'L', tail: 'URDDRUURRDR' },
            { r:  0, c: 13, dir: 'R', tail: 'LLDRDR' },
            { r:  1, c:  4, dir: 'U', tail: 'DRUURDR' },
            { r:  7, c:  5, dir: 'L', tail: 'DRUUUU' },
            { r:  7, c: 17, dir: 'U', tail: 'DLLULDLULDL' },
            { r: 10, c:  9, dir: 'D', tail: 'RURRRDRR' },
            { r:  5, c:  1, dir: 'D', tail: 'ULURRULLURU' },
            { r:  5, c:  9, dir: 'D', tail: 'RRURURDDRDR' },
            { r: 11, c: 16, dir: 'D', tail: 'LDLULDLULUR' },
            { r: 16, c: 14, dir: 'L', tail: 'ULLURRUL' },
            { r: 20, c:  1, dir: 'D', tail: 'RRURURU' },
            { r: 21, c: 11, dir: 'L', tail: 'URRULLLL' },
            { r:  9, c:  0, dir: 'D', tail: 'RURURURU' },
            { r: 15, c:  3, dir: 'L', tail: 'ULLLUUUURRDL' },
        ],
        walls: [],
    },
    // 31 — 18 arrows, 181 cells
    {
        arrows: [
            { r:  1, c:  5, dir: 'D', tail: 'RRRDRR' },
            { r: 18, c: 16, dir: 'D', tail: 'UUULUUL' },
            { r:  7, c:  5, dir: 'R', tail: 'DLULURRRU' },
            { r:  2, c:  4, dir: 'R', tail: 'ULLURRR' },
            { r: 20, c:  5, dir: 'R', tail: 'ULUUUURRURDRU' },
            { r:  1, c: 15, dir: 'U', tail: 'DRDDLLUR' },
            { r: 11, c: 13, dir: 'L', tail: 'RUULDLU' },
            { r: 14, c: 10, dir: 'U', tail: 'RRRULUR' },
            { r:  7, c: 12, dir: 'U', tail: 'RRRURDRDLD' },
            { r: 23, c: 10, dir: 'R', tail: 'LURURDRRULULUR' },
            { r: 16, c:  7, dir: 'U', tail: 'RDRRRDL' },
            { r: 20, c: 14, dir: 'D', tail: 'LUURRDDD' },
            { r:  7, c:  2, dir: 'R', tail: 'LLDDDR' },
            { r: 22, c: 15, dir: 'D', tail: 'RDRUUULURUUU' },
            { r: 22, c:  3, dir: 'D', tail: 'URRDLDRRUUURUU' },
            { r: 20, c:  2, dir: 'U', tail: 'DLULDDDRR' },
            { r: 11, c:  9, dir: 'L', tail: 'RULLUULLUR' },
            { r:  4, c:  2, dir: 'R', tail: 'ULUULDDDD' },
        ],
        walls: [],
    },
    // 32 — 20 arrows, 189 cells
    {
        arrows: [
            { r:  1, c:  9, dir: 'R', tail: 'ULDDDLULDLU' },
            { r: 23, c:  6, dir: 'U', tail: 'LUULUR' },
            { r: 23, c: 15, dir: 'R', tail: 'LLLLLLU' },
            { r: 15, c:  7, dir: 'L', tail: 'UURULURU' },
            { r: 17, c:  9, dir: 'L', tail: 'URDRURDRDDR' },
            { r:  0, c: 13, dir: 'R', tail: 'LDRRDR' },
            { r:  1, c:  4, dir: 'U', tail: 'DDLUUUL' },
            { r:  7, c:  5, dir: 'L', tail: 'DRUUUU' },
            { r:  7, c: 17, dir: 'U', tail: 'LDDLLURULLD' },
            { r: 10, c:  9, dir: 'D', tail: 'RURRRDRR' },
            { r:  5, c:  1, dir: 'D', tail: 'ULURRULLURU' },
            { r:  5, c:  9, dir: 'D', tail: 'RRURURDDRDR' },
            { r: 11, c: 16, dir: 'D', tail: 'RDDDDDDDDDD' },
            { r: 16, c: 14, dir: 'L', tail: 'ULLURRUL' },
            { r: 20, c:  1, dir: 'D', tail: 'RRURURU' },
            { r: 21, c: 10, dir: 'L', tail: 'ULURURRD' },
            { r:  9, c:  0, dir: 'D', tail: 'RURURURU' },
            { r: 15, c:  3, dir: 'L', tail: 'ULLLUUUURRDL' },
            { r: 22, c: 12, dir: 'L', tail: 'RUULLU' },
            { r: 12, c:  4, dir: 'L', tail: 'DDDDLL' },
        ],
        walls: [],
    },
    // 33 — 20 arrows, 201 cells
    {
        arrows: [
            { r:  1, c:  5, dir: 'D', tail: 'RURDDL' },
            { r: 18, c: 16, dir: 'D', tail: 'UUULUUL' },
            { r:  7, c:  5, dir: 'R', tail: 'DRDLLLURU' },
            { r:  2, c:  4, dir: 'R', tail: 'ULLURRR' },
            { r: 20, c:  5, dir: 'R', tail: 'ULUUUURRURDRU' },
            { r:  1, c: 15, dir: 'U', tail: 'DRDDLLUR' },
            { r: 11, c: 13, dir: 'L', tail: 'RUULDLU' },
            { r: 14, c: 10, dir: 'U', tail: 'RRRULUR' },
            { r:  7, c: 12, dir: 'U', tail: 'RRRURDRDLD' },
            { r: 23, c: 10, dir: 'R', tail: 'LURULUUULDLUUL' },
            { r: 16, c:  7, dir: 'U', tail: 'RDRRRDL' },
            { r: 20, c: 14, dir: 'D', tail: 'LUURRDDD' },
            { r:  7, c:  2, dir: 'R', tail: 'LLDDDR' },
            { r: 22, c: 15, dir: 'D', tail: 'LULLULLURRUU' },
            { r: 22, c:  3, dir: 'D', tail: 'LLLUURDRRUUUUL' },
            { r: 19, c:  2, dir: 'U', tail: 'LULURUUUU' },
            { r: 11, c:  9, dir: 'L', tail: 'DLDLLLDLLL' },
            { r:  4, c:  2, dir: 'R', tail: 'ULUULDDDD' },
            { r: 12, c: 16, dir: 'D', tail: 'LUURDRD' },
            { r: 12, c:  5, dir: 'L', tail: 'RRURUURRRUL' },
        ],
        walls: [],
    },
    // 34 — 22 arrows, 234 cells
    {
        arrows: [
            { r:  0, c:  9, dir: 'R', tail: 'LLDLULLLL' },
            { r: 15, c: 14, dir: 'L', tail: 'RUUUURDR' },
            { r: 10, c:  0, dir: 'R', tail: 'URURULLURRRUU' },
            { r: 21, c:  1, dir: 'D', tail: 'RRDDRRULUU' },
            { r: 20, c: 16, dir: 'D', tail: 'RULURUU' },
            { r: 12, c:  0, dir: 'L', tail: 'RDLDDDRRDR' },
            { r: 16, c:  7, dir: 'R', tail: 'DDLDLUUULUL' },
            { r: 19, c: 15, dir: 'D', tail: 'LLLURRRU' },
            { r: 10, c:  7, dir: 'R', tail: 'DRDDLDRDRDRD' },
            { r: 12, c:  7, dir: 'R', tail: 'LLUUUULLD' },
            { r: 23, c: 13, dir: 'D', tail: 'UUULLLUU' },
            { r: 15, c: 11, dir: 'D', tail: 'RULURRUURUUR' },
            { r:  1, c:  0, dir: 'R', tail: 'DDDDRRUURURR' },
            { r:  3, c:  4, dir: 'D', tail: 'RDDDDRURD' },
            { r:  8, c: 15, dir: 'L', tail: 'UUURRUULULDL' },
            { r:  0, c: 16, dir: 'D', tail: 'LLDLULDLULD' },
            { r: 23, c: 17, dir: 'D', tail: 'UULLDRDLLU' },
            { r:  5, c: 11, dir: 'L', tail: 'ULULDLUUL' },
            { r: 10, c: 13, dir: 'R', tail: 'LUULURRUU' },
            { r: 22, c:  8, dir: 'L', tail: 'URDRRDR' },
            { r: 22, c:  0, dir: 'D', tail: 'UUUURRDLD' },
            { r: 14, c:  2, dir: 'R', tail: 'UURDRRR' },
        ],
        walls: [],
    },
    // 35 — 24 arrows, 229 cells
    {
        arrows: [
            { r:  1, c:  9, dir: 'R', tail: 'LDRRRDLDLUL' },
            { r: 23, c:  6, dir: 'D', tail: 'LUULUR' },
            { r: 23, c: 15, dir: 'R', tail: 'UUULDDD' },
            { r: 15, c:  7, dir: 'L', tail: 'UURULURU' },
            { r: 17, c:  9, dir: 'L', tail: 'RRURDDLLLLL' },
            { r:  0, c: 13, dir: 'R', tail: 'LLDLUL' },
            { r:  1, c:  4, dir: 'U', tail: 'RDLDLUU' },
            { r:  7, c:  5, dir: 'L', tail: 'DRUUUU' },
            { r:  7, c: 17, dir: 'U', tail: 'DDLUULLDLLU' },
            { r: 10, c:  9, dir: 'D', tail: 'RURRRDRR' },
            { r:  5, c:  1, dir: 'D', tail: 'ULURRULLURU' },
            { r:  5, c:  9, dir: 'D', tail: 'RRURURDDRDR' },
            { r: 11, c: 16, dir: 'D', tail: 'LLLDRRDDDDD' },
            { r: 16, c: 14, dir: 'L', tail: 'ULLURRUL' },
            { r: 20, c:  1, dir: 'D', tail: 'RRURURU' },
            { r: 21, c: 10, dir: 'L', tail: 'ULLULLUU' },
            { r:  9, c:  0, dir: 'D', tail: 'RURURURU' },
            { r: 15, c:  3, dir: 'L', tail: 'ULLLUUUURRDL' },
            { r: 22, c: 12, dir: 'L', tail: 'RUULLU' },
            { r: 12, c:  4, dir: 'L', tail: 'DDDDLL' },
            { r: 19, c: 16, dir: 'R', tail: 'UUUURUULURUU' },
            { r:  3, c:  5, dir: 'L', tail: 'RURDDRDLDDRR' },
            { r: 22, c:  3, dir: 'D', tail: 'LDLLUR' },
            { r: 22, c:  9, dir: 'D', tail: 'ULDLUU' },
        ],
        walls: [],
    },
    // 36 — 24 arrows, 244 cells
    {
        arrows: [
            { r:  1, c: 14, dir: 'R', tail: 'DRDDRUURDDDDLU' },
            { r: 19, c:  6, dir: 'R', tail: 'UUUUUUUURRR' },
            { r: 23, c: 11, dir: 'L', tail: 'RURRUURU' },
            { r: 22, c:  6, dir: 'D', tail: 'RDRRUUULDLU' },
            { r:  6, c: 13, dir: 'U', tail: 'RRDDRRD' },
            { r: 18, c:  0, dir: 'R', tail: 'URURRD' },
            { r: 10, c:  4, dir: 'U', tail: 'RRRRRULLUR' },
            { r:  5, c:  0, dir: 'U', tail: 'RDLDRDRRDRURUR' },
            { r: 11, c:  0, dir: 'U', tail: 'RRULUR' },
            { r: 21, c: 12, dir: 'R', tail: 'UUULULULLU' },
            { r: 20, c: 16, dir: 'L', tail: 'RUUUULDDLUU' },
            { r:  5, c:  2, dir: 'U', tail: 'DDRUURRRURURRU' },
            { r: 19, c:  3, dir: 'L', tail: 'RRDLDDRUR' },
            { r: 14, c: 14, dir: 'L', tail: 'RRUURDDDLLL' },
            { r: 19, c:  1, dir: 'D', tail: 'RURRRUU' },
            { r:  2, c:  8, dir: 'L', tail: 'URURRD' },
            { r: 12, c: 13, dir: 'D', tail: 'URRRUU' },
            { r:  8, c: 14, dir: 'U', tail: 'LLUUULDLUUR' },
            { r: 13, c: 10, dir: 'D', tail: 'URULUURDRRURD' },
            { r: 17, c:  4, dir: 'R', tail: 'UULLLUL' },
            { r: 22, c: 16, dir: 'U', tail: 'RDLLU' },
            { r:  3, c: 10, dir: 'U', tail: 'RURRULUR' },
            { r: 11, c:  3, dir: 'L', tail: 'RDDRDD' },
            { r: 16, c: 12, dir: 'U', tail: 'DRUUUURUR' },
        ],
        walls: [],
    },
    // 37 — 26 arrows, 273 cells + 8 walls
    {
        arrows: [
            { r:  0, c:  9, dir: 'R', tail: 'DRRDRDLLL' },
            { r:  2, c:  2, dir: 'U', tail: 'RRDDLLDDDDDDLD' },
            { r: 21, c: 12, dir: 'R', tail: 'LURULUULLDDDRU' },
            { r: 10, c:  5, dir: 'R', tail: 'ULLURRRDRR' },
            { r: 15, c:  2, dir: 'L', tail: 'RULURRUUULDL' },
            { r: 19, c:  2, dir: 'R', tail: 'UUURRUUR' },
            { r: 14, c: 17, dir: 'R', tail: 'LLLURRRUUULU' },
            { r:  8, c: 11, dir: 'R', tail: 'LLDDLDLDLLU' },
            { r: 12, c:  1, dir: 'R', tail: 'LUUURULURUUU' },
            { r:  7, c: 17, dir: 'L', tail: 'ULLULURRULURRU' },
            { r: 20, c:  7, dir: 'R', tail: 'URUUURRU' },
            { r: 12, c: 12, dir: 'R', tail: 'UUURRDR' },
            { r: 22, c: 11, dir: 'D', tail: 'LDLUULDL' },
            { r: 22, c:  4, dir: 'L', tail: 'URUULDLUUU' },
            { r:  4, c: 13, dir: 'L', tail: 'URULUURD' },
            { r: 23, c:  2, dir: 'L', tail: 'ULULURRDRD' },
            { r:  8, c:  8, dir: 'L', tail: 'ULLLURUUU' },
            { r:  0, c:  5, dir: 'U', tail: 'DRDRRUL' },
            { r:  7, c: 10, dir: 'D', tail: 'UUURDDDRU' },
            { r: 18, c:  7, dir: 'D', tail: 'UUULUUR' },
            { r: 15, c:  9, dir: 'L', tail: 'UURRUUUU' },
            { r:  1, c:  1, dir: 'U', tail: 'LDRDLDD' },
            { r: 17, c: 17, dir: 'D', tail: 'UULLLLLU' },
            { r: 19, c:  0, dir: 'L', tail: 'UURULUU' },
            { r: 23, c: 17, dir: 'R', tail: 'LULUULLDRDD' },
            { r:  5, c:  7, dir: 'D', tail: 'UURDRDD' },
        ],
        walls: [[5, 4], [5, 5], [5, 12], [5, 13], [17, 4], [17, 5], [17, 12], [17, 13]],
    },
    // 38 — 28 arrows, 293 cells
    {
        arrows: [
            { r:  0, c:  9, dir: 'R', tail: 'DRDRDRURR' },
            { r: 15, c: 14, dir: 'L', tail: 'RUUUURDR' },
            { r: 10, c:  0, dir: 'R', tail: 'UURDRUURUUUUU' },
            { r: 21, c:  1, dir: 'D', tail: 'RRDDRRULUU' },
            { r: 20, c: 16, dir: 'D', tail: 'RULURUU' },
            { r: 12, c:  0, dir: 'L', tail: 'RDLDDDRRDR' },
            { r: 16, c:  7, dir: 'R', tail: 'ULDLULLURRR' },
            { r: 19, c: 15, dir: 'D', tail: 'LLLURRRU' },
            { r: 10, c:  7, dir: 'R', tail: 'LURUURURDRUR' },
            { r: 12, c:  7, dir: 'R', tail: 'LLUUUULLD' },
            { r: 23, c: 13, dir: 'D', tail: 'UUULLLUU' },
            { r: 15, c: 11, dir: 'D', tail: 'RULURRUURUUR' },
            { r:  1, c:  0, dir: 'R', tail: 'DDDDRURDDLLD' },
            { r:  3, c:  4, dir: 'D', tail: 'RRRDLLDRR' },
            { r:  8, c: 15, dir: 'L', tail: 'UUURRUULULDL' },
            { r:  0, c: 17, dir: 'D', tail: 'LLDLULDLULD' },
            { r: 23, c: 17, dir: 'D', tail: 'UULLDRDLLU' },
            { r:  5, c: 11, dir: 'L', tail: 'ULULDLUUL' },
            { r: 10, c: 13, dir: 'R', tail: 'LUULURRUU' },
            { r: 22, c:  8, dir: 'L', tail: 'UULLUUL' },
            { r: 22, c:  0, dir: 'D', tail: 'UUUURRDLD' },
            { r: 23, c: 12, dir: 'R', tail: 'ULDLUULUULU' },
            { r: 14, c:  2, dir: 'R', tail: 'UURDRRR' },
            { r:  1, c:  5, dir: 'R', tail: 'DLUURRR' },
            { r: 13, c:  8, dir: 'L', tail: 'UURDDRUURU' },
            { r: 10, c: 16, dir: 'R', tail: 'URULURU' },
            { r: 15, c: 10, dir: 'D', tail: 'ULLDDRDLLLL' },
            { r: 21, c:  6, dir: 'L', tail: 'RDLDRRR' },
        ],
        walls: [],
    },
    // 39 — 30 arrows, 281 cells + 12 walls
    {
        arrows: [
            { r:  0, c: 12, dir: 'U', tail: 'RRDDDRDD' },
            { r: 14, c:  5, dir: 'R', tail: 'UULUULD' },
            { r: 18, c:  0, dir: 'L', tail: 'RDLDRDRRRRUUR' },
            { r:  0, c:  6, dir: 'U', tail: 'RDRRDRDR' },
            { r:  5, c:  5, dir: 'R', tail: 'LDLULDD' },
            { r: 18, c:  9, dir: 'D', tail: 'LURURRUU' },
            { r:  4, c: 17, dir: 'U', tail: 'LUULURU' },
            { r:  7, c: 17, dir: 'R', tail: 'DDLULDDDLUU' },
            { r:  9, c:  8, dir: 'U', tail: 'RRRRURUULL' },
            { r: 22, c:  9, dir: 'L', tail: 'RURRRULU' },
            { r: 16, c:  6, dir: 'R', tail: 'LLLLDLL' },
            { r:  9, c:  3, dir: 'U', tail: 'RUURURRRRRDLL' },
            { r: 23, c: 15, dir: 'D', tail: 'RRUULURUUUL' },
            { r: 19, c: 16, dir: 'D', tail: 'ULULUURDRURD' },
            { r: 14, c:  6, dir: 'U', tail: 'RRURRDLD' },
            { r: 11, c: 10, dir: 'U', tail: 'LDRRURU' },
            { r: 12, c:  2, dir: 'D', tail: 'LDDDDLU' },
            { r:  3, c:  2, dir: 'U', tail: 'RUURDDRUU' },
            { r: 20, c:  2, dir: 'R', tail: 'UURURRRRU' },
            { r:  4, c:  1, dir: 'L', tail: 'ULURURULL' },
            { r: 23, c:  8, dir: 'L', tail: 'UUUURRUUR' },
            { r: 22, c:  4, dir: 'D', tail: 'RDRUURU' },
            { r:  2, c:  6, dir: 'U', tail: 'RDLDRDRRURDR' },
            { r: 17, c: 13, dir: 'R', tail: 'ULURUUL' },
            { r: 22, c:  0, dir: 'D', tail: 'RRR' },
            { r:  5, c: 16, dir: 'U', tail: 'RDLLLUU' },
            { r: 14, c:  2, dir: 'D', tail: 'URRDLDRR' },
            { r: 23, c: 14, dir: 'R', tail: 'ULLLDRR' },
            { r: 13, c: 16, dir: 'R', tail: 'DLULULL' },
            { r:  7, c:  0, dir: 'R', tail: 'DDDRU' },
        ],
        walls: [[4, 4], [4, 5], [4, 12], [4, 13], [11, 0], [11, 1], [11, 16], [11, 17], [18, 4], [18, 5], [18, 12], [18, 13]],
    },
    // 40 — 30 arrows, 300 cells
    {
        arrows: [
            { r:  1, c: 17, dir: 'R', tail: 'ULDLDLUULDL' },
            { r:  2, c:  9, dir: 'U', tail: 'DRRRULULURR' },
            { r: 14, c: 15, dir: 'L', tail: 'ULLURULULULUU' },
            { r: 18, c:  7, dir: 'L', tail: 'UURDDRRRRUUU' },
            { r: 12, c: 17, dir: 'U', tail: 'DLULUURD' },
            { r: 14, c:  6, dir: 'L', tail: 'DLDLULDLUL' },
            { r: 20, c:  2, dir: 'L', tail: 'ULUULUU' },
            { r:  0, c:  0, dir: 'L', tail: 'RDRURRRDLLDD' },
            { r:  5, c:  1, dir: 'D', tail: 'RURRDRU' },
            { r: 21, c: 17, dir: 'L', tail: 'UULUUURDD' },
            { r:  8, c:  7, dir: 'L', tail: 'UURDRDRD' },
            { r: 12, c:  8, dir: 'U', tail: 'DRRDDLULLU' },
            { r: 14, c:  3, dir: 'L', tail: 'RRUULDLU' },
            { r: 23, c:  1, dir: 'D', tail: 'RRRRURRRULLL' },
            { r:  5, c: 12, dir: 'R', tail: 'DRRRRDRU' },
            { r: 11, c:  5, dir: 'L', tail: 'RURRRUL' },
            { r: 19, c: 10, dir: 'L', tail: 'LLLLDLLLURR' },
            { r:  7, c:  0, dir: 'L', tail: 'RDDLU' },
            { r: 22, c: 10, dir: 'U', tail: 'DRRULUUURDRUU' },
            { r: 18, c:  4, dir: 'D', tail: 'LLURRRRD' },
            { r: 10, c:  1, dir: 'L', tail: 'RDDDLULDD' },
            { r: 11, c:  9, dir: 'U', tail: 'RRRDDDL' },
            { r:  4, c: 13, dir: 'U', tail: 'DRRULUR' },
            { r:  8, c:  3, dir: 'L', tail: 'RDDRUURU' },
            { r:  6, c:  9, dir: 'L', tail: 'RULURRD' },
            { r:  6, c:  2, dir: 'D', tail: 'LLUURUU' },
            { r: 16, c: 13, dir: 'U', tail: 'RURDDLDDD' },
            { r: 22, c: 16, dir: 'D', tail: 'UULDDDLLU' },
            { r:  8, c: 12, dir: 'D', tail: 'URRRDRDLL' },
            { r:  1, c:  6, dir: 'R', tail: 'DDRDLDRR' },
        ],
        walls: [],
    },
    // 41 — 31 arrows, 236 cells
    {
        arrows: [
            { r:  7, c:  5, dir: 'D', tail: 'LULDLU' },
            { r: 11, c:  1, dir: 'U', tail: 'DLDDDDRURR' },
            { r:  6, c:  0, dir: 'U', tail: 'DRDLDRDLD' },
            { r: 16, c:  9, dir: 'U', tail: 'LUU' },
            { r: 21, c:  8, dir: 'D', tail: 'RDDRRUU' },
            { r:  3, c: 13, dir: 'L', tail: 'RUULULLL' },
            { r: 10, c:  8, dir: 'R', tail: 'URD' },
            { r:  6, c: 11, dir: 'R', tail: 'URURRRRUU' },
            { r: 21, c:  3, dir: 'D', tail: 'LLLU' },
            { r: 20, c: 10, dir: 'R', tail: 'RUURR' },
            { r: 12, c:  6, dir: 'U', tail: 'UUULDDD' },
            { r:  4, c:  9, dir: 'L', tail: 'LURURRU' },
            { r: 14, c: 16, dir: 'R', tail: 'RDDDLUULU' },
            { r: 13, c:  1, dir: 'R', tail: 'RRULUURUL' },
            { r:  0, c: 16, dir: 'U', tail: 'RDDDDDDLU' },
            { r: 12, c:  4, dir: 'D', tail: 'UUUURRRUUU' },
            { r: 22, c: 16, dir: 'R', tail: 'DLUU' },
            { r:  4, c:  7, dir: 'U', tail: 'ULLUUL' },
            { r: 12, c: 15, dir: 'R', tail: 'RUUURUULDL' },
            { r:  2, c:  1, dir: 'U', tail: 'LDDDR' },
            { r: 17, c:  4, dir: 'D', tail: 'LLURRURR' },
            { r:  2, c:  3, dir: 'U', tail: 'ULLULD' },
            { r: 22, c:  1, dir: 'L', tail: 'LDRRRRR' },
            { r: 13, c: 13, dir: 'R', tail: 'RULUURDR' },
            { r: 16, c:  7, dir: 'D', tail: 'UUUU' },
            { r: 18, c:  3, dir: 'L', tail: 'DDRURURD' },
            { r: 18, c:  0, dir: 'L', tail: 'URDRD' },
            { r: 23, c: 12, dir: 'D', tail: 'URRDL' },
            { r: 23, c: 17, dir: 'R', tail: 'UUU' },
            { r: 23, c:  8, dir: 'D', tail: 'LLUUL' },
            { r:  1, c:  6, dir: 'U', tail: 'URRRDR' },
        ],
        walls: [],
    },
    // 42 — 32 arrows, 236 cells
    {
        arrows: [
            { r:  7, c:  6, dir: 'L', tail: 'DDLD' },
            { r:  6, c:  3, dir: 'L', tail: 'LDRDDLL' },
            { r:  1, c: 10, dir: 'R', tail: 'LDDRRU' },
            { r:  8, c:  4, dir: 'D', tail: 'DDDRDDDRR' },
            { r: 23, c:  7, dir: 'D', tail: 'LULURRR' },
            { r: 17, c: 17, dir: 'D', tail: 'DDLD' },
            { r: 14, c: 11, dir: 'R', tail: 'DDDDDRURD' },
            { r: 19, c:  5, dir: 'L', tail: 'RDRRRDRUU' },
            { r:  2, c:  0, dir: 'L', tail: 'DDDDRDLDD' },
            { r:  5, c:  4, dir: 'R', tail: 'ULLU' },
            { r:  2, c:  8, dir: 'U', tail: 'UULDDL' },
            { r:  9, c:  9, dir: 'R', tail: 'DLDRRR' },
            { r: 15, c: 15, dir: 'D', tail: 'URRUUL' },
            { r: 10, c: 17, dir: 'R', tail: 'ULDDR' },
            { r: 11, c: 15, dir: 'U', tail: 'DDL' },
            { r: 18, c: 15, dir: 'D', tail: 'DDDRRDLLL' },
            { r: 18, c:  5, dir: 'L', tail: 'LLURRRURD' },
            { r: 20, c: 12, dir: 'D', tail: 'RRUUURRU' },
            { r: 13, c:  1, dir: 'L', tail: 'DDRD' },
            { r:  4, c:  5, dir: 'U', tail: 'DRRUURD' },
            { r:  9, c: 12, dir: 'U', tail: 'ULLLL' },
            { r:  5, c:  9, dir: 'R', tail: 'LDRRUUL' },
            { r: 12, c: 13, dir: 'U', tail: 'DDRDLDDLUU' },
            { r: 23, c: 14, dir: 'R', tail: 'RRR' },
            { r: 21, c:  3, dir: 'L', tail: 'DDRR' },
            { r: 22, c:  1, dir: 'L', tail: 'DLUURRUR' },
            { r:  7, c:  7, dir: 'R', tail: 'ULL' },
            { r:  3, c:  1, dir: 'U', tail: 'URRDRUUU' },
            { r: 18, c:  0, dir: 'L', tail: 'DDRUUURDDR' },
            { r:  2, c: 17, dir: 'R', tail: 'DDDD' },
            { r:  0, c:  9, dir: 'U', tail: 'RRDRD' },
            { r: 15, c:  0, dir: 'L', tail: 'UUUUUR' },
        ],
        walls: [[15, 9], [15, 17]],
    },
    // 43 — 33 arrows, 219 cells
    {
        arrows: [
            { r:  7, c:  8, dir: 'U', tail: 'LLLDRDDLDR' },
            { r: 15, c: 17, dir: 'R', tail: 'LDDRD' },
            { r:  4, c: 10, dir: 'L', tail: 'LDLLLULDLD' },
            { r: 18, c: 16, dir: 'D', tail: 'DDRDL' },
            { r: 18, c: 10, dir: 'D', tail: 'DDRUUULLL' },
            { r:  6, c:  7, dir: 'R', tail: 'RRRDDRU' },
            { r:  3, c: 10, dir: 'L', tail: 'LLLUURDRRR' },
            { r: 21, c: 11, dir: 'D', tail: 'DDRR' },
            { r: 20, c:  6, dir: 'D', tail: 'URRR' },
            { r:  1, c: 16, dir: 'U', tail: 'DLLDL' },
            { r:  4, c:  0, dir: 'U', tail: 'URDRUUU' },
            { r:  5, c:  3, dir: 'U', tail: 'LDL' },
            { r:  9, c:  3, dir: 'L', tail: 'DRDDR' },
            { r: 23, c:  4, dir: 'L', tail: 'RURRDL' },
            { r: 23, c:  9, dir: 'D', tail: 'URUL' },
            { r: 10, c:  2, dir: 'L', tail: 'DDLLUUU' },
            { r:  2, c:  3, dir: 'U', tail: 'URDRD' },
            { r: 21, c:  0, dir: 'D', tail: 'RUULD' },
            { r: 19, c: 15, dir: 'D', tail: 'DLULUR' },
            { r: 15, c: 10, dir: 'L', tail: 'RRRRDRUU' },
            { r: 17, c:  2, dir: 'L', tail: 'DRDDDDDL' },
            { r:  5, c: 12, dir: 'U', tail: 'LDRDRU' },
            { r:  7, c:  3, dir: 'L', tail: 'RDD' },
            { r:  0, c: 12, dir: 'R', tail: 'DRD' },
            { r:  8, c: 14, dir: 'R', tail: 'DRRDLL' },
            { r: 13, c: 17, dir: 'U', tail: 'LDR' },
            { r:  2, c:  1, dir: 'U', tail: 'LUU' },
            { r: 23, c:  0, dir: 'D', tail: 'URD' },
            { r: 16, c:  5, dir: 'L', tail: 'RRURRURRRR' },
            { r: 14, c:  7, dir: 'L', tail: 'LDLU' },
            { r: 22, c:  8, dir: 'D', tail: 'D' },
            { r: 12, c:  9, dir: 'R', tail: 'URDD' },
            { r:  0, c:  7, dir: 'U', tail: 'RRDRURD' },
        ],
        walls: [],
    },
    // 44 — 34 arrows, 232 cells
    {
        arrows: [
            { r:  7, c:  9, dir: 'L', tail: 'DRRDLLLL' },
            { r: 10, c:  4, dir: 'D', tail: 'DRDLLU' },
            { r: 15, c: 10, dir: 'R', tail: 'RRDRDDDRU' },
            { r: 16, c:  5, dir: 'L', tail: 'LDRRUULL' },
            { r: 14, c: 16, dir: 'D', tail: 'DDDLLURUUL' },
            { r:  5, c:  4, dir: 'U', tail: 'DRRURU' },
            { r:  4, c:  3, dir: 'U', tail: 'RURURDR' },
            { r: 22, c:  6, dir: 'D', tail: 'ULLU' },
            { r:  1, c: 16, dir: 'L', tail: 'LURRDD' },
            { r: 12, c:  6, dir: 'R', tail: 'RUUR' },
            { r:  3, c: 16, dir: 'R', tail: 'RDLLULLLD' },
            { r: 22, c:  2, dir: 'U', tail: 'DLU' },
            { r:  1, c:  7, dir: 'U', tail: 'URRR' },
            { r:  6, c: 15, dir: 'R', tail: 'LUULDD' },
            { r: 12, c:  1, dir: 'U', tail: 'LDDDDDRU' },
            { r:  9, c: 12, dir: 'R', tail: 'RDRDR' },
            { r: 18, c:  1, dir: 'L', tail: 'RRULURU' },
            { r: 19, c:  8, dir: 'L', tail: 'UUL' },
            { r: 20, c:  1, dir: 'L', tail: 'LUU' },
            { r:  9, c: 16, dir: 'R', tail: 'LULL' },
            { r: 23, c: 14, dir: 'R', tail: 'RRURULURU' },
            { r:  3, c:  1, dir: 'U', tail: 'LDRDDDDR' },
            { r:  2, c:  4, dir: 'L', tail: 'ULLDDDDDDR' },
            { r:  0, c:  2, dir: 'U', tail: 'RRR' },
            { r: 22, c: 12, dir: 'D', tail: 'ULD' },
            { r: 13, c: 12, dir: 'R', tail: 'DRURRRULLL' },
            { r:  1, c: 13, dir: 'U', tail: 'URD' },
            { r:  7, c: 11, dir: 'R', tail: 'LUULDLDLU' },
            { r: 22, c:  3, dir: 'D', tail: 'ULLLDD' },
            { r:  0, c:  6, dir: 'U', tail: 'DL' },
            { r:  7, c:  0, dir: 'L', tail: 'UU' },
            { r:  0, c: 11, dir: 'U', tail: 'RDDLLD' },
            { r: 10, c: 16, dir: 'R', tail: 'L' },
            { r: 23, c: 10, dir: 'D', tail: 'ULDLLL' },
        ],
        walls: [[21, 9], [5, 5], [8, 8], [21, 10]],
    },
    // 45 — 35 arrows, 231 cells
    {
        arrows: [
            { r:  7, c: 11, dir: 'L', tail: 'RDRURD' },
            { r: 23, c: 15, dir: 'L', tail: 'LULULD' },
            { r: 12, c:  8, dir: 'U', tail: 'RRDRDL' },
            { r:  7, c: 16, dir: 'D', tail: 'DRDL' },
            { r: 23, c: 11, dir: 'D', tail: 'RR' },
            { r:  5, c: 15, dir: 'L', tail: 'RDRUULLLU' },
            { r:  8, c:  9, dir: 'L', tail: 'RRDR' },
            { r: 12, c:  1, dir: 'U', tail: 'RRULLLUR' },
            { r:  5, c: 12, dir: 'U', tail: 'UUUR' },
            { r:  4, c:  6, dir: 'U', tail: 'UUL' },
            { r:  9, c:  9, dir: 'L', tail: 'DRRDLL' },
            { r: 17, c:  4, dir: 'D', tail: 'UUU' },
            { r: 18, c:  2, dir: 'D', tail: 'UULL' },
            { r: 20, c:  0, dir: 'L', tail: 'RRRRUUL' },
            { r: 20, c: 17, dir: 'R', tail: 'LULLU' },
            { r:  0, c:  6, dir: 'L', tail: 'LDLLUR' },
            { r: 23, c:  7, dir: 'U', tail: 'URDRRUU' },
            { r:  3, c:  1, dir: 'U', tail: 'ULUURRDDD' },
            { r: 16, c: 10, dir: 'R', tail: 'ULLLDLDL' },
            { r: 12, c: 13, dir: 'R', tail: 'DDLUUURRUR' },
            { r:  4, c:  3, dir: 'L', tail: 'UUR' },
            { r:  5, c:  9, dir: 'L', tail: 'UURDR' },
            { r: 14, c:  7, dir: 'U', tail: 'LDLUUUURDR' },
            { r: 15, c: 12, dir: 'R', tail: 'LDRDDL' },
            { r:  3, c:  0, dir: 'L', tail: 'DRR' },
            { r: 21, c: 16, dir: 'R', tail: 'DRDL' },
            { r:  2, c:  8, dir: 'U', tail: 'DDDLDRD' },
            { r: 12, c: 17, dir: 'R', tail: 'DLLURUL' },
            { r: 23, c:  2, dir: 'D', tail: 'UULDLDR' },
            { r: 18, c: 15, dir: 'R', tail: 'RRULUULDD' },
            { r:  1, c:  7, dir: 'R', tail: 'L' },
            { r: 15, c:  1, dir: 'L', tail: 'LUUU' },
            { r:  6, c:  6, dir: 'L', tail: 'ULULDLD' },
            { r: 11, c: 17, dir: 'R', tail: 'UL' },
            { r:  7, c:  5, dir: 'L', tail: 'RRDD' },
        ],
        walls: [],
    },
    // 46 — 36 arrows, 264 cells
    {
        arrows: [
            { r:  7, c: 13, dir: 'U', tail: 'DDLL' },
            { r: 14, c: 15, dir: 'R', tail: 'LURRRU' },
            { r: 16, c: 15, dir: 'R', tail: 'URR' },
            { r:  0, c:  7, dir: 'L', tail: 'DLDRDRRU' },
            { r:  4, c:  8, dir: 'L', tail: 'LLULDLUUU' },
            { r: 13, c: 11, dir: 'D', tail: 'DLUU' },
            { r:  3, c: 12, dir: 'R', tail: 'LDDDLUUU' },
            { r: 14, c:  6, dir: 'D', tail: 'DLDLDRDR' },
            { r:  8, c:  5, dir: 'L', tail: 'LLDRR' },
            { r: 10, c: 13, dir: 'L', tail: 'LLLLULD' },
            { r: 20, c: 14, dir: 'D', tail: 'RDL' },
            { r:  2, c:  5, dir: 'U', tail: 'UULLDDDDLU' },
            { r:  7, c: 11, dir: 'L', tail: 'RDLLLULUL' },
            { r: 22, c:  7, dir: 'D', tail: 'RDRRR' },
            { r: 11, c:  3, dir: 'R', tail: 'LDRRUULLLD' },
            { r:  3, c: 16, dir: 'R', tail: 'LDLLURURR' },
            { r: 18, c:  8, dir: 'R', tail: 'LDL' },
            { r:  2, c:  8, dir: 'U', tail: 'URRDRRURD' },
            { r: 16, c:  2, dir: 'D', tail: 'RDD' },
            { r:  2, c:  0, dir: 'L', tail: 'RRUULLDR' },
            { r:  8, c: 17, dir: 'R', tail: 'UUUL' },
            { r: 12, c:  1, dir: 'L', tail: 'LDRDDRR' },
            { r: 10, c: 16, dir: 'R', tail: 'DRUUL' },
            { r:  5, c:  1, dir: 'L', tail: 'DLUUURD' },
            { r: 23, c:  5, dir: 'L', tail: 'LLLLUUU' },
            { r: 18, c:  1, dir: 'L', tail: 'DLUUUUU' },
            { r: 22, c: 13, dir: 'D', tail: 'DLULULU' },
            { r: 23, c: 14, dir: 'D', tail: 'URRDL' },
            { r: 18, c: 11, dir: 'R', tail: 'RURDDR' },
            { r:  7, c:  2, dir: 'L', tail: 'DLLUR' },
            { r:  0, c: 13, dir: 'U', tail: 'LLLLL' },
            { r: 20, c: 17, dir: 'D', tail: 'LDRDD' },
            { r: 21, c:  6, dir: 'D', tail: 'ULLU' },
            { r: 18, c: 17, dir: 'R', tail: 'DLULURURD' },
            { r:  1, c: 15, dir: 'R', tail: 'RRDDDL' },
            { r: 23, c:  7, dir: 'D', tail: 'LULULDLL' },
        ],
        walls: [[0, 15], [22, 10], [12, 12], [21, 3]],
    },
    // 47 — 37 arrows, 245 cells
    {
        arrows: [
            { r:  7, c: 14, dir: 'R', tail: 'ULLUULDDDL' },
            { r:  1, c:  4, dir: 'D', tail: 'LLDDRURDR' },
            { r: 17, c:  9, dir: 'D', tail: 'LLULDDR' },
            { r: 11, c:  0, dir: 'U', tail: 'RUUR' },
            { r: 21, c: 11, dir: 'D', tail: 'DLUULLDRDD' },
            { r: 12, c:  2, dir: 'D', tail: 'LDRD' },
            { r:  5, c:  1, dir: 'L', tail: 'ULURUU' },
            { r:  1, c: 14, dir: 'U', tail: 'URR' },
            { r:  1, c:  0, dir: 'U', tail: 'URR' },
            { r:  3, c: 17, dir: 'U', tail: 'LULLLL' },
            { r:  3, c:  7, dir: 'U', tail: 'LDR' },
            { r: 22, c:  3, dir: 'L', tail: 'DRUU' },
            { r: 17, c:  1, dir: 'D', tail: 'RUULULU' },
            { r: 18, c:  0, dir: 'D', tail: 'RDRDDLDDLU' },
            { r: 11, c:  9, dir: 'R', tail: 'DDRUUULURR' },
            { r: 13, c: 11, dir: 'R', tail: 'DDDRUUUR' },
            { r: 19, c: 15, dir: 'R', tail: 'UULURRRDL' },
            { r: 23, c: 14, dir: 'R', tail: 'UULL' },
            { r: 21, c:  0, dir: 'L', tail: 'UU' },
            { r: 11, c: 15, dir: 'R', tail: 'RDDDLUL' },
            { r: 20, c: 14, dir: 'R', tail: 'LUULLLU' },
            { r: 19, c:  6, dir: 'D', tail: 'DRUR' },
            { r: 10, c: 17, dir: 'R', tail: 'DDDDDLLL' },
            { r: 15, c:  0, dir: 'L', tail: 'DR' },
            { r: 23, c: 10, dir: 'D', tail: 'RRR' },
            { r: 11, c:  8, dir: 'U', tail: 'LDLDDRU' },
            { r:  1, c: 13, dir: 'U', tail: 'LUL' },
            { r:  9, c:  8, dir: 'U', tail: 'LDR' },
            { r: 11, c:  5, dir: 'D', tail: 'UULL' },
            { r:  7, c: 17, dir: 'R', tail: 'DLLDRR' },
            { r:  6, c: 15, dir: 'R', tail: 'RUR' },
            { r: 22, c:  8, dir: 'D', tail: 'LUL' },
            { r:  2, c: 10, dir: 'U', tail: 'DDLU' },
            { r:  8, c: 13, dir: 'L', tail: 'RDLLDRRDDL' },
            { r:  8, c: 12, dir: 'L', tail: 'UR' },
            { r:  7, c:  5, dir: 'L', tail: 'URU' },
            { r:  6, c:  1, dir: 'L', tail: 'RRRURULLDL' },
        ],
        walls: [[12, 11], [7, 6], [4, 17], [17, 0], [6, 9], [11, 6]],
    },
    // 48 — 38 arrows, 277 cells
    {
        arrows: [
            { r:  7, c: 16, dir: 'L', tail: 'LURULULL' },
            { r: 18, c: 15, dir: 'R', tail: 'LLUR' },
            { r:  9, c:  9, dir: 'U', tail: 'LDDRURUUL' },
            { r: 20, c: 13, dir: 'R', tail: 'URRRDDRDLL' },
            { r: 19, c:  7, dir: 'L', tail: 'DDDD' },
            { r: 16, c: 13, dir: 'R', tail: 'LDDLLDDDD' },
            { r:  4, c: 12, dir: 'U', tail: 'ULUUU' },
            { r: 21, c:  6, dir: 'U', tail: 'ULULDL' },
            { r: 18, c:  9, dir: 'L', tail: 'ULU' },
            { r:  3, c: 16, dir: 'R', tail: 'LLLULUUR' },
            { r:  7, c: 14, dir: 'L', tail: 'LDDRURRR' },
            { r: 10, c: 17, dir: 'R', tail: 'ULLDLLLD' },
            { r:  3, c: 10, dir: 'U', tail: 'DDLUU' },
            { r:  1, c:  1, dir: 'U', tail: 'ULDDR' },
            { r:  0, c:  4, dir: 'U', tail: 'DRRRURRR' },
            { r: 23, c:  1, dir: 'D', tail: 'URDRRUR' },
            { r: 15, c:  2, dir: 'R', tail: 'DRDRRRUR' },
            { r:  0, c:  2, dir: 'U', tail: 'RDDDRRUL' },
            { r: 22, c: 13, dir: 'D', tail: 'LUUULDD' },
            { r: 14, c: 16, dir: 'R', tail: 'LLLLU' },
            { r:  0, c: 14, dir: 'R', tail: 'RRD' },
            { r:  6, c: 17, dir: 'U', tail: 'D' },
            { r: 11, c: 13, dir: 'R', tail: 'RDRURDRDD' },
            { r: 15, c: 17, dir: 'R', tail: 'LDRDDLULU' },
            { r: 11, c:  5, dir: 'L', tail: 'RDDRUUUUL' },
            { r: 18, c:  1, dir: 'L', tail: 'RDDDLLD' },
            { r:  6, c:  7, dir: 'L', tail: 'DRRURR' },
            { r:  4, c:  6, dir: 'L', tail: 'RRDLLDLUL' },
            { r:  8, c:  4, dir: 'L', tail: 'ULLLURRR' },
            { r: 20, c:  8, dir: 'D', tail: 'DDRDRRR' },
            { r:  7, c:  0, dir: 'L', tail: 'DRDLDRR' },
            { r: 12, c:  1, dir: 'L', tail: 'URDRRDRU' },
            { r: 20, c:  0, dir: 'L', tail: 'RULUUUUUU' },
            { r:  4, c:  2, dir: 'L', tail: 'UUU' },
            { r:  4, c: 17, dir: 'U', tail: 'D' },
            { r:  5, c:  1, dir: 'L', tail: 'RRU' },
            { r:  2, c: 16, dir: 'R', tail: 'LLUR' },
            { r: 12, c:  0, dir: 'L', tail: 'U' },
        ],
        walls: [],
    },
    // 49 — 39 arrows, 265 cells
    {
        arrows: [
            { r:  7, c:  0, dir: 'U', tail: 'URDRRR' },
            { r: 10, c: 11, dir: 'R', tail: 'RDDRURUUUR' },
            { r: 11, c:  9, dir: 'D', tail: 'DRRU' },
            { r:  2, c:  5, dir: 'R', tail: 'RRRDDLLDRR' },
            { r: 17, c:  2, dir: 'R', tail: 'UULDDLD' },
            { r:  8, c:  4, dir: 'D', tail: 'RDDDLUULU' },
            { r: 13, c:  0, dir: 'L', tail: 'UUUUU' },
            { r:  6, c: 13, dir: 'R', tail: 'LURUULUR' },
            { r:  0, c: 13, dir: 'R', tail: 'DLLU' },
            { r: 10, c: 10, dir: 'U', tail: 'LUULUR' },
            { r: 11, c:  7, dir: 'D', tail: 'LUU' },
            { r: 12, c:  4, dir: 'D', tail: 'RDR' },
            { r: 17, c:  7, dir: 'R', tail: 'RDLDRDD' },
            { r: 21, c:  4, dir: 'D', tail: 'LDDRU' },
            { r:  3, c:  2, dir: 'U', tail: 'UUURDRD' },
            { r: 17, c:  6, dir: 'D', tail: 'LDLDL' },
            { r: 13, c: 10, dir: 'R', tail: 'DRURRRD' },
            { r: 12, c: 17, dir: 'U', tail: 'DDLDL' },
            { r:  1, c: 17, dir: 'R', tail: 'DDDD' },
            { r:  5, c: 16, dir: 'U', tail: 'DRDDDLUULU' },
            { r: 15, c: 13, dir: 'D', tail: 'LLDLULDL' },
            { r:  3, c:  1, dir: 'U', tail: 'UULDDDDR' },
            { r:  0, c:  8, dir: 'U', tail: 'DRRDDRU' },
            { r:  0, c:  1, dir: 'U', tail: 'L' },
            { r: 14, c:  8, dir: 'L', tail: 'DLDLUURU' },
            { r: 23, c: 16, dir: 'D', tail: 'LURUURDD' },
            { r: 17, c: 13, dir: 'D', tail: 'RDD' },
            { r:  3, c: 15, dir: 'U', tail: 'LURUL' },
            { r: 20, c: 13, dir: 'D', tail: 'RDDLLL' },
            { r: 23, c:  8, dir: 'D', tail: 'ULULUR' },
            { r: 23, c: 12, dir: 'D', tail: 'RR' },
            { r: 11, c: 16, dir: 'R', tail: 'RULLU' },
            { r: 16, c:  0, dir: 'L', tail: 'UURRUU' },
            { r: 19, c:  9, dir: 'D', tail: 'URDRR' },
            { r: 17, c: 15, dir: 'R', tail: 'RRU' },
            { r:  0, c: 17, dir: 'U', tail: 'LDDDDLDLU' },
            { r: 23, c:  5, dir: 'D', tail: 'UUULL' },
            { r: 21, c: 10, dir: 'D', tail: 'RRR' },
            { r:  1, c:  6, dir: 'U', tail: 'LUL' },
        ],
        walls: [[11, 15], [1, 7], [16, 16], [4, 4]],
    },
    // 50 — 40 arrows, 288 cells
    {
        arrows: [
            { r:  7, c:  1, dir: 'L', tail: 'LURU' },
            { r: 19, c:  7, dir: 'D', tail: 'DRDRURDD' },
            { r: 23, c:  4, dir: 'R', tail: 'LULLL' },
            { r: 17, c: 10, dir: 'R', tail: 'LLDDR' },
            { r: 19, c: 15, dir: 'R', tail: 'DRUULL' },
            { r: 16, c: 15, dir: 'L', tail: 'ULLLLDLLU' },
            { r:  3, c:  6, dir: 'D', tail: 'DLUUULULL' },
            { r: 21, c:  7, dir: 'D', tail: 'LUUL' },
            { r: 16, c:  8, dir: 'L', tail: 'ULDLDDL' },
            { r: 15, c:  0, dir: 'L', tail: 'RRUR' },
            { r:  3, c:  3, dir: 'L', tail: 'RULULLLDD' },
            { r:  8, c: 11, dir: 'U', tail: 'UULL' },
            { r:  7, c: 15, dir: 'U', tail: 'RDR' },
            { r: 20, c:  2, dir: 'L', tail: 'DLLUR' },
            { r: 10, c: 10, dir: 'R', tail: 'UUUL' },
            { r: 17, c: 13, dir: 'D', tail: 'LDDL' },
            { r:  0, c:  1, dir: 'L', tail: 'L' },
            { r: 14, c:  0, dir: 'L', tail: 'RUURRUL' },
            { r: 12, c: 10, dir: 'R', tail: 'RRRRRDRURD' },
            { r:  6, c: 13, dir: 'U', tail: 'DDR' },
            { r: 14, c:  8, dir: 'R', tail: 'LLLLUURRRR' },
            { r:  9, c:  2, dir: 'L', tail: 'RUUURURRD' },
            { r: 19, c:  4, dir: 'L', tail: 'UUL' },
            { r: 11, c:  1, dir: 'L', tail: 'URRRD' },
            { r: 15, c: 17, dir: 'R', tail: 'DLDR' },
            { r:  2, c:  9, dir: 'R', tail: 'LURULLLL' },
            { r:  9, c: 12, dir: 'U', tail: 'UUUURRULLU' },
            { r: 22, c: 14, dir: 'R', tail: 'DLLL' },
            { r:  2, c: 15, dir: 'U', tail: 'RRDL' },
            { r:  6, c: 16, dir: 'R', tail: 'URULLULULU' },
            { r: 21, c: 14, dir: 'R', tail: 'RRDLDRRU' },
            { r: 10, c: 16, dir: 'R', tail: 'RDL' },
            { r: 16, c:  0, dir: 'L', tail: 'RRDLDLDR' },
            { r:  0, c: 13, dir: 'R', tail: 'RDRRRULL' },
            { r: 14, c: 12, dir: 'R', tail: 'URRDRRD' },
            { r:  4, c: 11, dir: 'U', tail: 'LLDLULDD' },
            { r: 13, c:  0, dir: 'L', tail: 'UU' },
            { r:  9, c: 17, dir: 'R', tail: 'LLLLDRR' },
            { r:  0, c: 12, dir: 'U', tail: 'DLDLDLLLU' },
            { r: 22, c:  6, dir: 'D', tail: 'DLULURULLD' },
        ],
        walls: [[13, 8], [10, 0], [6, 14], [11, 15], [11, 5], [4, 0]],
    },

];

const TOTAL_LEVELS = LEVELS.length;

// Cells occupied by an arrow: head + tail steps walked from head
const getArrowCells = (arrow) => {
    const cells = [{ r: arrow.r, c: arrow.c }];
    let r = arrow.r;
    let c = arrow.c;
    for (const ch of arrow.tail || '') {
        const [dc, dr] = DIR_VEC[ch];
        r += dr;
        c += dc;
        cells.push({ r, c });
    }
    return cells;
};

// Cells from arrow head forward to grid edge (exclusive of head)
const getForwardPath = (arrow) => {
    const [dc, dr] = DIR_VEC[arrow.dir];
    const out = [];
    let r = arrow.r + dr;
    let c = arrow.c + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
        out.push({ r, c });
        r += dr;
        c += dc;
    }
    return out;
};

// Parse level → cells array (walls + arrows)
const parseLevel = (level) => {
    const cells = [];
    (level.walls || []).forEach(([r, c], i) => {
        cells.push({ key: `w-${i}`, type: 'wall', r, c });
    });
    (level.arrows || []).forEach((a, i) => {
        cells.push({
            key: `a-${i}`,
            type: 'arrow',
            r: a.r,
            c: a.c,
            dir: a.dir,
            tail: a.tail || '',
            colorIdx: i % ARROW_COLORS.length,
        });
    });
    return cells;
};

// Is the forward path clear of other arrows' cells and walls?
// Arrows already in flight (keys in `flyingKeys`) are treated as gone.
const isPathClear = (cells, arrow, flyingKeys) => {
    const forward = getForwardPath(arrow);
    const obstacles = [];
    cells.forEach((x) => {
        if (x === arrow) return;
        if (flyingKeys && flyingKeys.has(x.key)) return;
        if (x.type === 'wall') {
            obstacles.push({ r: x.r, c: x.c });
        } else if (x.type === 'arrow') {
            obstacles.push(...getArrowCells(x));
        }
    });
    return !forward.some((p) =>
        obstacles.some((o) => o.r === p.r && o.c === p.c)
    );
};

const STARS_STORE_KEY = 'arrow_game_stars';
const MAX_LIVES = 3;
const AUTO_HINT_LEVELS = 3; // levels 1-3 (0-indexed: 0,1,2) auto-show hint

const ArrowGameScreen = () => {
    const navigation = useNavigation();
    const { theme } = useGlobalState();
    const isDarkMode = theme === 'dark';
    const c = useMemo(() => getThemeColors(isDarkMode), [isDarkMode]);
    const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);
    // Initial level is restored from MMKV so users resume where they left off.
    // Clamped to a valid index in case LEVELS shrinks in a future release.
    const savedLevel = storage.getNumber(LVL_STORE_KEY) ?? 0;
    const initialLevel = Math.min(Math.max(0, savedLevel), LEVELS.length - 1);
    const [levelIdx, setLevelIdx] = useState(initialLevel);
    const [cells, setCells] = useState(() => parseLevel(LEVELS[initialLevel]));
    const [won, setWon] = useState(false);
    // Arrows currently mid-flight — used to swap static stems for traveling dots
    const [flying, setFlying] = useState(() => new Set());
    // Wrong tap counter for star rating
    const [wrongTaps, setWrongTaps] = useState(0);
    // Lives (3 hearts). Reaches 0 → level fails.
    const [livesLeft, setLivesLeft] = useState(MAX_LIVES);
    const [failed, setFailed] = useState(false);
    // Key of arrow unlocked via Hint button (shown with glow on levels 4+). null = no hint.
    const [hintKey, setHintKey] = useState(null);
    // Sound toggle
    const [soundOn, setSoundOn] = useState(true);
    // Level transition fade
    const gridOpacity = useRef(new Animated.Value(1)).current;
    // Confetti ref
    const confettiRef = useRef(null);
    // Guards the level-complete confetti so the scheduled-from-handleTap pop
    // and the useEffect safety-net don't double-fire on the same clear.
    const confettiFiredRef = useRef(false);
    // Glow animation for free arrows
    const glowAnim = useRef(new Animated.Value(0)).current;

    // ── Responsive layout ─────────────────────────────────────────────
    // Recomputes when the window, safe-area insets, or Pro status change
    // (Pro users don't render a banner, so the grid can reclaim that space).
    const { width: winW, height: winH } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const { isPro } = useProStatus();
    const { CELL_SIZE, GRID_W, GRID_H, WALL_PAD, STROKE_W, HALF, HIT_SLOP } = useMemo(() => {
        const bannerH = isPro ? 0 : BANNER_H;
        const devNavH = __DEV__ ? DEV_NAV_H : 0;
        const chrome =
            insets.top + HEADER_CONTENT_H +
            GAME_AREA_PAD_TOP + STATUS_ROW_H + GRID_MARGIN_TOP +
            HINT_LINE_H + bannerH + devNavH + insets.bottom + CHROME_BUFFER;

        const cellFromW = Math.floor((winW - GRID_MARGIN * 2 - GRID_PAD * 2) / COLS);
        const cellFromH = Math.floor((winH - chrome - GRID_PAD * 2) / ROWS);
        const cell = Math.max(12, Math.min(cellFromW, cellFromH));
        // hitSlop floor keeps tap targets usable on small phones — combined with
        // the cell, effective tap diameter stays ≥ ~36pt even at CELL_SIZE 12.
        const slop = Math.max(12, Math.floor(cell * 0.5));
        return {
            CELL_SIZE: cell,
            GRID_W: cell * COLS + GRID_PAD * 2,
            GRID_H: cell * ROWS + GRID_PAD * 2,
            WALL_PAD: Math.max(2, Math.floor(cell * 0.15)),
            STROKE_W: Math.max(3, Math.floor(cell * 0.12)),
            HALF: cell / 2,
            HIT_SLOP: slop,
        };
    }, [winW, winH, insets.top, insets.bottom, isPro]);

    const cellCenter = useCallback((r, c) => ({
        x: GRID_PAD + c * CELL_SIZE + CELL_SIZE / 2,
        y: GRID_PAD + r * CELL_SIZE + CELL_SIZE / 2,
    }), [CELL_SIZE]);

    // Init sounds on mount
    useEffect(() => {
        // Init ads so they're preloaded for hint/level triggers
        InterstitialAdManager.init();
        let enabled = true;
        try { enabled = storage.getBoolean('game_sound_arrow') !== false; } catch {}
        setSoundOn(enabled);
        initGameSounds().then(() => { if (enabled) startAmbient(); });
        return () => { stopAmbient(); releaseGameSounds(); };
    }, []);

    // Glow breathing loop
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(glowAnim, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                Animated.timing(glowAnim, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ])
        );
        loop.start();
        return () => loop.stop();
    }, [glowAnim]);

    // Persist level idx whenever it changes
    useEffect(() => {
        storage.set(LVL_STORE_KEY, levelIdx);
    }, [levelIdx]);

    // Per-body-cell Animated values keyed by `${arrowKey}-${cellIdx}`
    const anims = useRef({}).current;
    const shakes = useRef({}).current;

    const getCellAnim = (arrowKey, cellIdx) => {
        const k = `${arrowKey}-${cellIdx}`;
        if (!anims[k]) {
            const progress = new Animated.Value(0);
            anims[k] = {
                progress,
                // tx/ty start as plain values at rest; handleTap rebinds them to
                // interpolations of `progress` at flight time so the whole path
                // is driven by a single native-driver timing.
                tx: new Animated.Value(0),
                ty: new Animated.Value(0),
                opacity: new Animated.Value(1),
            };
        }
        return anims[k];
    };
    const getShake = (key) => {
        if (!shakes[key]) shakes[key] = new Animated.Value(0);
        return shakes[key];
    };

    const loadLevel = useCallback((idx) => {
        // Fade out, swap, fade in
        Animated.timing(gridOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
            Object.keys(anims).forEach((k) => delete anims[k]);
            Object.keys(shakes).forEach((k) => delete shakes[k]);
            const newCells = parseLevel(LEVELS[idx]);
            setCells(newCells);
            setWon(false);
            setFailed(false);
            setFlying(new Set());
            setWrongTaps(0);
            setLivesLeft(MAX_LIVES);
            setHintKey(null);
            confettiFiredRef.current = false;
            Animated.timing(gridOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
        });
    }, [anims, shakes, gridOpacity]);

    useEffect(() => {
        if (won || failed) return;
        const remaining = cells.filter((c) => c.type === 'arrow').length;
        if (remaining > 0) return;
        const hadArrows = (LEVELS[levelIdx].arrows || []).length > 0;
        if (hadArrows) {
            // Safety net: if the handleTap-scheduled pop didn't fire (rare —
            // e.g. JS thread stalled past the scheduled delay), pop it here.
            if (!confettiFiredRef.current) {
                confettiFiredRef.current = true;
                confettiRef.current?.start();
            }
            ReactNativeHapticFeedback.trigger('notificationSuccess');
            playPop('arrow');
            setTimeout(() => playWoosh('arrow'), 200);
            setTimeout(() => setWon(true), 800);
            const stars = wrongTaps === 0 ? 3 : wrongTaps === 1 ? 2 : 1;
            const starsData = JSON.parse(storage.getString(STARS_STORE_KEY) || '{}');
            const prev = starsData[levelIdx] || 0;
            if (stars > prev) {
                starsData[levelIdx] = stars;
                storage.set(STARS_STORE_KEY, JSON.stringify(starsData));
            }
        }
    }, [cells, won, failed, levelIdx, wrongTaps]);

    const handleTap = useCallback((cell) => {
        if (cell.type !== 'arrow' || won || failed) return;
        if (flying.has(cell.key)) return; // already in flight
        if (!isPathClear(cells, cell, flying)) {
            // Wrong tap — shake + buzz, cost one life + one star point.
            ReactNativeHapticFeedback.trigger('impactMedium');
            playPop('arrow');
            setWrongTaps((w) => w + 1);
            setLivesLeft((lv) => {
                const next = Math.max(0, lv - 1);
                if (next === 0) {
                    // Failed — trigger fail overlay after the shake settles
                    ReactNativeHapticFeedback.trigger('notificationError');
                    setTimeout(() => setFailed(true), 300);
                }
                return next;
            });
            const shake = getShake(cell.key);
            Animated.sequence([
                Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
                Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
                Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
            ]).start();
            return;
        }
        // Correct tap — woosh plays when arrow flies. No haptic click here (the
        // vibration motor is audible on some devices and reads as a "bip" sound).
        // Consume hint if this was the hinted arrow.
        if (hintKey === cell.key) setHintKey(null);

        // Snake-style flight: head leaves first, each tail cell follows the cell
        // ahead of it by one tick. After every body cell has exited off-grid, remove.
        const body = getArrowCells(cell);               // [head, T1, T2, ...]
        const headInit = cellCenter(cell.r, cell.c);
        const [dc, dr] = DIR_VEC[cell.dir];
        const escape = { dx: dc * CELL_SIZE, dy: dr * CELL_SIZE };
        // Ticks needed for the HEAD to exit fully (plus a buffer for smooth offscreen)
        const ticksToExit = Math.ceil((Math.max(GRID_W, GRID_H) + CELL_SIZE) / CELL_SIZE);
        const totalTicks = ticksToExit + body.length;
        const TICK_MS = 80;

        // Build ONE timing per body cell that drives a 0→1 progress value.
        // The tx/ty of each cell is an interpolation of progress across the
        // tick-indexed waypoints, so animation setup stays cheap (O(body) JS
        // work + bridge payload) and the first frame lands immediately.
        const inputRange = new Array(totalTicks + 1);
        for (let k = 0; k <= totalTicks; k++) inputRange[k] = k / totalTicks;

        const perCellAnims = body.map((bodyCell, i) => {
            const initialPx = cellCenter(bodyCell.r, bodyCell.c);
            const anim = getCellAnim(cell.key, i);

            const xs = new Array(totalTicks + 1);
            const ys = new Array(totalTicks + 1);
            xs[0] = 0;
            ys[0] = 0;
            for (let k = 1; k <= totalTicks; k++) {
                let tx, ty;
                if (k <= i) {
                    const source = body[i - k];
                    const p = cellCenter(source.r, source.c);
                    tx = p.x - initialPx.x;
                    ty = p.y - initialPx.y;
                } else {
                    const steps = k - i;
                    tx = headInit.x + steps * escape.dx - initialPx.x;
                    ty = headInit.y + steps * escape.dy - initialPx.y;
                }
                xs[k] = tx;
                ys[k] = ty;
            }

            anim.progress.setValue(0);
            anim.opacity.setValue(1);
            // Rebind tx/ty to native-driver interpolations of progress. The
            // JSX re-read (triggered by setFlying below) picks up the new
            // nodes; native driver keeps progress advancing across the swap.
            anim.tx = anim.progress.interpolate({ inputRange, outputRange: xs });
            anim.ty = anim.progress.interpolate({ inputRange, outputRange: ys });

            const fadeStart = (i + ticksToExit - 1) * TICK_MS;
            const fadeAnim = Animated.sequence([
                Animated.delay(fadeStart),
                Animated.timing(anim.opacity, {
                    toValue: 0,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]);

            const pathAnim = Animated.timing(anim.progress, {
                toValue: 1,
                duration: totalTicks * TICK_MS,
                easing: Easing.linear,
                useNativeDriver: true,
            });

            return Animated.parallel([pathAnim, fadeAnim]);
        });

        playWoosh('arrow');
        // If this is the final arrow (no other non-flying arrows left), pop
        // confetti exactly when the last tail cell reaches its off-grid
        // waypoint. We treat in-flight arrows as already-gone so back-to-back
        // taps still detect the last one correctly.
        const isLastArrow = cells.filter(
            (c) => c.type === 'arrow' && c.key !== cell.key && !flying.has(c.key),
        ).length === 0;
        if (isLastArrow && !confettiFiredRef.current) {
            const hideAtMs = (totalTicks - 1) * TICK_MS;
            setTimeout(() => {
                if (confettiFiredRef.current) return;
                confettiFiredRef.current = true;
                confettiRef.current?.start();
            }, hideAtMs);
        }
        // Kick off native animation BEFORE setFlying so the first frame of
        // motion is queued at the same time React is asked to paint the
        // "flying" shape swap — user sees shape change + motion together
        // instead of shape-swap → pause → motion.
        Animated.parallel(perCellAnims).start(() => {
            setCells((prev) => prev.filter((x) => x.key !== cell.key));
            setFlying((prev) => {
                const next = new Set(prev);
                next.delete(cell.key);
                return next;
            });
        });
        setFlying((prev) => {
            const next = new Set(prev);
            next.add(cell.key);
            return next;
        });
    }, [cells, won, failed, flying, hintKey, levelIdx, loadLevel, CELL_SIZE, GRID_W, GRID_H, cellCenter]);

    const handleRestart = () => loadLevel(levelIdx);
    const handleRequestHint = useCallback(() => {
        if (hintKey || won || failed) return;
        const free = cells.find((c) => c.type === 'arrow' && isPathClear(cells, c, flying));
        if (!free) return;
        // Pro users skip the ad; free users see an interstitial (hint reveals
        // either way, since the ad may not be loaded yet).
        if (!isPro) showInterstitial();
        ReactNativeHapticFeedback.trigger('selection');
        setHintKey(free.key);
    }, [cells, flying, hintKey, won, failed, isPro]);
    const handleNext = () => {
        const next = (levelIdx + 1) % TOTAL_LEVELS;
        if (!isPro && (levelIdx + 1) % 5 === 0) showInterstitial();
        setLevelIdx(next);
        loadLevel(next);
    };
    const toggleSound = () => {
        const next = !soundOn;
        setSoundOn(next);
        setSoundEnabled('arrow', next);
        if (next) startAmbient(); else stopAmbient();
        ReactNativeHapticFeedback.trigger('selection');
    };

    // Compute star rating for current level
    const currentStars = wrongTaps === 0 ? 3 : wrongTaps === 1 ? 2 : 1;

    // Dot grid (light line-art aesthetic)
    const gridDots = useMemo(() => {
        const out = [];
        const DOT_SIZE = 3;
        for (let r = 0; r < ROWS; r++) {
            for (let cc = 0; cc < COLS; cc++) {
                const { x, y } = cellCenter(r, cc);
                out.push(
                    <View
                        key={`d-${r}-${cc}`}
                        style={[
                            styles.gridDot,
                            {
                                left: x - DOT_SIZE / 2,
                                top: y - DOT_SIZE / 2,
                                width: DOT_SIZE,
                                height: DOT_SIZE,
                            },
                        ]}
                    />
                );
            }
        }
        return out;
    }, [cellCenter, styles.gridDot]);

    return (
        <View style={styles.container}>
            <SafeAreaView edges={['top']} style={{ backgroundColor: isDarkMode ? c.bg : '#3B82F6' }}>
                <View style={[styles.plainHeader, { backgroundColor: isDarkMode ? c.bg : '#3B82F6' }]}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
                        <Ionicons name="chevron-back" size={18} color="#FFF" />
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={{ color: '#FFF', fontSize: 18, fontWeight: 'bold' }}>Arrow Puzzle</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>{`Level ${levelIdx + 1} of ${TOTAL_LEVELS}`}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity onPress={toggleSound} style={styles.headerBtn}>
                            <Ionicons name={soundOn ? 'volume-high' : 'volume-mute'} size={18} color="#FFF" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={handleRestart} style={styles.headerBtn}>
                            <Ionicons name="refresh" size={20} color="#FFF" />
                        </TouchableOpacity>
                    </View>
                </View>
            </SafeAreaView>

            <View style={styles.gameArea}>
                <View style={styles.statusBar}>
                    <View style={styles.heartsRow}>
                        {[0, 1, 2].map((i) => (
                            <Ionicons
                                key={i}
                                name={i < livesLeft ? 'heart' : 'heart-outline'}
                                size={22}
                                color={i < livesLeft ? '#EF4444' : '#6B7280'}
                                style={{ marginRight: 4 }}
                            />
                        ))}
                    </View>
                    {levelIdx >= AUTO_HINT_LEVELS && (
                        <TouchableOpacity
                            onPress={handleRequestHint}
                            disabled={!!hintKey || won || failed}
                            style={[styles.hintBtn, (!!hintKey || won || failed) && { opacity: 0.4 }]}
                        >
                            <Ionicons name="bulb" size={16} color="#FFD93D" />
                            <Text style={styles.hintBtnText}>Hint</Text>
                            <Ionicons name="play" size={10} color="#9CA3AF" style={{ marginLeft: 4 }} />
                        </TouchableOpacity>
                    )}
                </View>

                <View style={styles.gridWrap}>
                <Animated.View style={[styles.grid, { width: GRID_W, height: GRID_H, opacity: gridOpacity }]}>
                    {gridDots}

                    {cells.map((cell) => {
                        if (cell.type === 'wall') {
                            return (
                                <View
                                    key={cell.key}
                                    style={[
                                        styles.wall,
                                        {
                                            left: GRID_PAD + cell.c * CELL_SIZE + WALL_PAD,
                                            top: GRID_PAD + cell.r * CELL_SIZE + WALL_PAD,
                                            width: CELL_SIZE - WALL_PAD * 2,
                                            height: CELL_SIZE - WALL_PAD * 2,
                                        },
                                    ]}
                                />
                            );
                        }
                        const shake = getShake(cell.key);
                        const shakeTranslate = shake.interpolate({
                            inputRange: [-1, 0, 1],
                            outputRange: [-4, 0, 4],
                        });
                        const colorPair = ARROW_COLORS[cell.colorIdx] || ARROW_COLORS[0];
                        const strokeColor = colorPair[1];
                        const body = getArrowCells(cell);
                        const isFlying = flying.has(cell.key);
                        const isFree = !isFlying && isPathClear(cells, cell, flying);
                        const shakeX = cell.dir === 'U' || cell.dir === 'D' ? shakeTranslate : 0;
                        const shakeY = cell.dir === 'L' || cell.dir === 'R' ? shakeTranslate : 0;

                        // Line-segment rectangle extending from cell center toward `dir`
                        const lineStyleFor = (dir) => {
                            if (dir === 'R') return { left: HALF, top: HALF - STROKE_W / 2, width: HALF, height: STROKE_W };
                            if (dir === 'L') return { left: 0, top: HALF - STROKE_W / 2, width: HALF, height: STROKE_W };
                            if (dir === 'D') return { left: HALF - STROKE_W / 2, top: HALF, width: STROKE_W, height: HALF };
                            return { left: HALF - STROKE_W / 2, top: 0, width: STROKE_W, height: HALF };
                        };

                        return (
                            <View key={cell.key} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
                                {body.map((bc, idx) => {
                                    const isHead = idx === 0;
                                    const isEnd = idx === body.length - 1;
                                    const anim = getCellAnim(cell.key, idx);
                                    const initPx = cellCenter(bc.r, bc.c);

                                    // Direction from this cell back to its predecessor (opposite of the
                                    // tail-char that led here). Null for head.
                                    const prevDir = idx > 0 ? DIR_OPP[cell.tail[idx - 1]] : null;
                                    // Direction toward the next cell along the tail.
                                    const nextDir = idx < body.length - 1 ? cell.tail[idx] : null;

                                    return (
                                        <Animated.View
                                            key={`${cell.key}-c${idx}`}
                                            pointerEvents="auto"
                                            style={{
                                                position: 'absolute',
                                                left: initPx.x - HALF,
                                                top: initPx.y - HALF,
                                                width: CELL_SIZE,
                                                height: CELL_SIZE,
                                                opacity: anim.opacity,
                                                transform: [
                                                    { translateX: Animated.add(anim.tx, shakeX) },
                                                    { translateY: Animated.add(anim.ty, shakeY) },
                                                ],
                                                zIndex: isHead ? 10 : 1,
                                            }}
                                        >
                                            {/* At rest: static line-art stems. During flight: hide
                                                so the traveling dots (below) read as a snake. */}
                                            {!isFlying && prevDir && (
                                                <View
                                                    pointerEvents="none"
                                                    style={[
                                                        styles.stroke,
                                                        lineStyleFor(prevDir),
                                                        { backgroundColor: strokeColor },
                                                    ]}
                                                />
                                            )}

                                            {!isFlying && nextDir && (
                                                <View
                                                    pointerEvents="none"
                                                    style={[
                                                        styles.stroke,
                                                        lineStyleFor(nextDir),
                                                        { backgroundColor: strokeColor },
                                                    ]}
                                                />
                                            )}

                                            {/* Center joint — small at rest, beefier during flight so
                                                each tail cell reads clearly as a traveling rope bead. */}
                                            {!isHead && (
                                                <View
                                                    pointerEvents="none"
                                                    style={{
                                                        position: 'absolute',
                                                        left: HALF - (isFlying ? STROKE_W * 1.8 : STROKE_W) / 2,
                                                        top: HALF - (isFlying ? STROKE_W * 1.8 : STROKE_W) / 2,
                                                        width: isFlying ? STROKE_W * 1.8 : STROKE_W,
                                                        height: isFlying ? STROKE_W * 1.8 : STROKE_W,
                                                        backgroundColor: strokeColor,
                                                        borderRadius: isFlying ? STROKE_W : 1,
                                                    }}
                                                />
                                            )}

                                            {/* Rounded end-cap at tail tip (only at rest) */}
                                            {!isFlying && isEnd && !isHead && (
                                                <View
                                                    pointerEvents="none"
                                                    style={{
                                                        position: 'absolute',
                                                        left: HALF - STROKE_W / 2,
                                                        top: HALF - STROKE_W / 2,
                                                        width: STROKE_W,
                                                        height: STROKE_W,
                                                        backgroundColor: strokeColor,
                                                        borderRadius: STROKE_W / 2,
                                                    }}
                                                />
                                            )}

                                            {/* Glow pulse on heads with a clear path.
                                                Centered on the arrowhead's visual midpoint (shifted toward
                                                the firing edge so the triangle tip sits inside the glow).
                                                Shown on tutorial levels (1-3) for every free arrow,
                                                or on any level for the one arrow unlocked via Hint. */}
                                            {isHead && isFree && !isFlying && (levelIdx < AUTO_HINT_LEVELS || hintKey === cell.key) && (() => {
                                                const [dc, dr] = DIR_VEC[cell.dir];
                                                const OFF = CELL_SIZE * 0.25;
                                                const cx = HALF + dc * OFF;
                                                const cy = HALF + dr * OFF;
                                                return (
                                                    <Animated.View
                                                        pointerEvents="none"
                                                        style={{
                                                            position: 'absolute',
                                                            left: cx - CELL_SIZE * 0.6,
                                                            top: cy - CELL_SIZE * 0.6,
                                                            width: CELL_SIZE * 1.2,
                                                            height: CELL_SIZE * 1.2,
                                                            borderRadius: CELL_SIZE * 0.6,
                                                            backgroundColor: strokeColor,
                                                            opacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.45] }),
                                                        }}
                                                    />
                                                );
                                            })()}

                                            {/* Head: forward stem + solid triangular tip at the edge.
                                                Triangle drawn with CSS borders for a crisp look. */}
                                            {isHead && (
                                                <>
                                                    {!isFlying && (() => {
                                                        const TIP_LEN = Math.max(6, Math.floor(CELL_SIZE * 0.35));
                                                        const TIP_W = Math.max(6, Math.floor(CELL_SIZE * 0.4));
                                                        // Shortened stem that meets the triangle base cleanly
                                                        const stemShortStyle = (d) => {
                                                            const stemLen = HALF - TIP_LEN + STROKE_W;
                                                            if (stemLen <= 0) return null;
                                                            if (d === 'R') return { left: HALF, top: HALF - STROKE_W / 2, width: stemLen, height: STROKE_W };
                                                            if (d === 'L') return { left: HALF - stemLen, top: HALF - STROKE_W / 2, width: stemLen, height: STROKE_W };
                                                            if (d === 'D') return { left: HALF - STROKE_W / 2, top: HALF, width: STROKE_W, height: stemLen };
                                                            return { left: HALF - STROKE_W / 2, top: HALF - stemLen, width: STROKE_W, height: stemLen };
                                                        };
                                                        const tipStyle = (d) => {
                                                            // Each direction: one border has color, the two perpendicular ones are transparent
                                                            const base = {
                                                                position: 'absolute',
                                                                width: 0, height: 0,
                                                                borderTopColor: 'transparent',
                                                                borderBottomColor: 'transparent',
                                                                borderLeftColor: 'transparent',
                                                                borderRightColor: 'transparent',
                                                            };
                                                            if (d === 'R') return {
                                                                ...base,
                                                                left: CELL_SIZE - TIP_LEN,
                                                                top: HALF - TIP_W / 2,
                                                                borderTopWidth: TIP_W / 2,
                                                                borderBottomWidth: TIP_W / 2,
                                                                borderLeftWidth: TIP_LEN,
                                                                borderLeftColor: strokeColor,
                                                            };
                                                            if (d === 'L') return {
                                                                ...base,
                                                                left: 0,
                                                                top: HALF - TIP_W / 2,
                                                                borderTopWidth: TIP_W / 2,
                                                                borderBottomWidth: TIP_W / 2,
                                                                borderRightWidth: TIP_LEN,
                                                                borderRightColor: strokeColor,
                                                            };
                                                            if (d === 'D') return {
                                                                ...base,
                                                                left: HALF - TIP_W / 2,
                                                                top: CELL_SIZE - TIP_LEN,
                                                                borderLeftWidth: TIP_W / 2,
                                                                borderRightWidth: TIP_W / 2,
                                                                borderTopWidth: TIP_LEN,
                                                                borderTopColor: strokeColor,
                                                            };
                                                            return {
                                                                ...base,
                                                                left: HALF - TIP_W / 2,
                                                                top: 0,
                                                                borderLeftWidth: TIP_W / 2,
                                                                borderRightWidth: TIP_W / 2,
                                                                borderBottomWidth: TIP_LEN,
                                                                borderBottomColor: strokeColor,
                                                            };
                                                        };
                                                        const ss = stemShortStyle(cell.dir);
                                                        return (
                                                            <>
                                                                {ss && (
                                                                    <View
                                                                        pointerEvents="none"
                                                                        style={[styles.stroke, ss, { backgroundColor: strokeColor }]}
                                                                    />
                                                                )}
                                                                <View pointerEvents="none" style={tipStyle(cell.dir)} />
                                                            </>
                                                        );
                                                    })()}
                                                    <Pressable
                                                        onPress={() => handleTap(cell)}
                                                        hitSlop={HIT_SLOP}
                                                        style={{
                                                            position: 'absolute',
                                                            left: 0, top: 0, right: 0, bottom: 0,
                                                        }}
                                                    />
                                                </>
                                            )}

                                            {/* Tail cells also tappable — fires the same arrow */}
                                            {!isHead && (
                                                <Pressable
                                                    onPress={() => handleTap(cell)}
                                                    hitSlop={Math.max(10, Math.floor(HIT_SLOP * 0.8))}
                                                    style={{
                                                        position: 'absolute',
                                                        left: 0, top: 0, right: 0, bottom: 0,
                                                    }}
                                                />
                                            )}

                                            {/* Red flash on wrong-tap shake */}
                                            <Animated.View
                                                pointerEvents="none"
                                                style={{
                                                    position: 'absolute',
                                                    left: 0, top: 0, right: 0, bottom: 0,
                                                    backgroundColor: '#EF4444',
                                                    borderRadius: 4,
                                                    opacity: shake.interpolate({
                                                        inputRange: [-1, 0, 1],
                                                        outputRange: [0.45, 0, 0.45],
                                                    }),
                                                }}
                                            />
                                        </Animated.View>
                                    );
                                })}
                            </View>
                        );
                    })}
                </Animated.View>
                <Text style={styles.hint}>Tap an arrow. Tails block — clear blockers first.</Text>
                </View>
            </View>

            {failed && !won && (
                <View style={styles.winOverlay}>
                    <View style={styles.winCard}>
                        <Ionicons name="heart-dislike" size={48} color="#EF4444" />
                        <Text style={styles.winTitle}>Out of Lives</Text>
                        <Text style={styles.winSub}>Clear blockers before tapping. Try again!</Text>
                        <View style={styles.winActions}>
                            <TouchableOpacity style={styles.winBtn} onPress={handleRestart}>
                                <View style={[styles.winBtnGradient, { backgroundColor: '#4F46E5' }]}>
                                    <Text style={styles.winBtnText}>Retry</Text>
                                    <Ionicons name="refresh" size={18} color="#FFF" />
                                </View>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

            {won && (
                <View style={styles.winOverlay}>
                    <View style={styles.winCard}>
                        <Ionicons name="trophy" size={48} color="#FFD93D" />
                        <Text style={styles.winTitle}>Level Clear!</Text>
                        <View style={styles.starsRow}>
                            {[1, 2, 3].map((s) => (
                                <Ionicons
                                    key={s}
                                    name={s <= currentStars ? 'star' : 'star-outline'}
                                    size={28}
                                    color={s <= currentStars ? '#FFD93D' : (isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)')}
                                />
                            ))}
                        </View>
                        <Text style={styles.winSub}>
                            {currentStars === 3 ? 'Perfect — no mistakes!' : currentStars === 2 ? 'Great job — almost perfect!' : 'Cleared! Try again for more stars.'}
                        </Text>
                        <View style={styles.winActions}>
                            <TouchableOpacity style={styles.winBtnSecondary} onPress={handleRestart}>
                                <Text style={styles.winBtnSecondaryText}>Replay</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.winBtn} onPress={handleNext}>
                                <View style={[styles.winBtnGradient, { backgroundColor: '#4F46E5' }]}>
                                    <Text style={styles.winBtnText}>
                                        {levelIdx + 1 === TOTAL_LEVELS ? 'Start Over' : 'Next Level'}
                                    </Text>
                                    <Ionicons name="arrow-forward" size={18} color="#FFF" />
                                </View>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

            <Confetti ref={confettiRef} />

            {__DEV__ && (
                <View style={styles.devNav}>
                    <TouchableOpacity
                        style={[styles.devNavBtn, levelIdx === 0 && styles.devNavBtnDisabled]}
                        disabled={levelIdx === 0}
                        onPress={() => {
                            const prev = levelIdx - 1;
                            setLevelIdx(prev);
                            loadLevel(prev);
                        }}
                    >
                        <Ionicons name="chevron-back" size={22} color="#FFF" />
                    </TouchableOpacity>
                    <Text style={styles.devNavLabel}>DEV · Level {levelIdx + 1}/{TOTAL_LEVELS}</Text>
                    <TouchableOpacity
                        style={[styles.devNavBtn, levelIdx === TOTAL_LEVELS - 1 && styles.devNavBtnDisabled]}
                        disabled={levelIdx === TOTAL_LEVELS - 1}
                        onPress={() => {
                            const next = levelIdx + 1;
                            setLevelIdx(next);
                            loadLevel(next);
                        }}
                    >
                        <Ionicons name="chevron-forward" size={22} color="#FFF" />
                    </TouchableOpacity>
                </View>
            )}

            <BannerAdView />
            <SafeAreaView edges={['bottom']} style={{ backgroundColor: isDarkMode ? c.bg : c.bgAlt }} />
        </View>
    );
};

const getStyles = (isDark, c) => StyleSheet.create({
    container: { flex: 1, backgroundColor: isDark ? c.bg : c.bgAlt },
    plainHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        minHeight: 40,
        backgroundColor: isDark ? c.bg : '#3B82F6',
    },
    headerBtn: {
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center', justifyContent: 'center',
    },
    gameArea: { flex: 1, alignItems: 'center', paddingTop: spacing.md },
    statusBar: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.sm,
        marginBottom: spacing.xs,
    },
    heartsRow: { flexDirection: 'row', alignItems: 'center' },
    hintBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
        borderWidth: 1,
        borderColor: isDark ? 'rgba(255,217,61,0.4)' : 'rgba(245,158,11,0.4)',
        borderRadius: borderRadius.md,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    hintBtnText: {
        color: isDark ? '#FFD93D' : '#D97706',
        fontFamily: typography.fontFamily.medium,
        fontSize: typography.sizes.xs,
        marginLeft: 4,
    },
    hint: {
        fontFamily: typography.fontFamily.medium,
        fontSize: typography.sizes.xs,
        color: c.textSecondary,
        marginTop: spacing.md,
        paddingHorizontal: spacing.lg,
        textAlign: 'center',
    },
    gridWrap: {
        flex: 1,
        width: '100%',
        alignItems: 'center',
        paddingTop: 3,
    },
    grid: {
        position: 'relative',
        backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        borderRadius: borderRadius.md,
        borderWidth: 1,
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        overflow: 'hidden',
    },
    gridDot: {
        position: 'absolute',
        borderRadius: 2,
        backgroundColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
    },
    devNav: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        borderTopWidth: 1,
        borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    devNavBtn: {
        width: 44, height: 36, borderRadius: 10,
        backgroundColor: 'rgba(124,58,237,0.6)',
        alignItems: 'center', justifyContent: 'center',
    },
    devNavBtnDisabled: { opacity: 0.3 },
    devNavLabel: {
        fontFamily: typography.fontFamily.medium,
        fontSize: typography.sizes.xs,
        color: c.textSecondary,
        letterSpacing: 1,
    },
    wall: {
        position: 'absolute',
        backgroundColor: isDark ? '#3F3F52' : '#D1D5DB',
        borderRadius: 6,
        borderWidth: 1,
        borderColor: isDark ? '#52526B' : '#B0B5C0',
    },
    stroke: {
        position: 'absolute',
        borderRadius: 1,
    },
    winOverlay: {
        ...StyleSheet.absoluteFill,
        backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
        alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: spacing.xl,
    },
    winCard: {
        backgroundColor: isDark ? c.bgAlt : c.bgElevated,
        borderRadius: borderRadius.lg,
        padding: spacing.xl,
        alignItems: 'center',
        width: '100%',
        ...(isDark ? {} : { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 }),
    },
    winTitle: {
        fontFamily: typography.fontFamily.bold,
        fontSize: typography.sizes.xl,
        color: c.text,
        marginTop: spacing.sm,
    },
    starsRow: {
        flexDirection: 'row',
        gap: 6,
        marginTop: spacing.sm,
    },
    winSub: {
        fontFamily: typography.fontFamily.regular,
        fontSize: typography.sizes.sm,
        color: c.textSecondary,
        marginTop: spacing.xs,
        textAlign: 'center',
    },
    winActions: {
        flexDirection: 'row', gap: spacing.sm,
        marginTop: spacing.lg, width: '100%',
    },
    winBtnSecondary: {
        flex: 1, paddingVertical: spacing.md,
        borderRadius: borderRadius.md,
        alignItems: 'center',
        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    winBtnSecondaryText: {
        fontFamily: typography.fontFamily.bold,
        fontSize: typography.sizes.sm,
        color: c.text,
    },
    winBtn: { flex: 1.5, borderRadius: borderRadius.md, overflow: 'hidden' },
    winBtnGradient: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: spacing.md,
    },
    winBtnText: {
        fontFamily: typography.fontFamily.bold,
        fontSize: typography.sizes.sm,
        color: '#FFF',
    },
});

export default ArrowGameScreen;
