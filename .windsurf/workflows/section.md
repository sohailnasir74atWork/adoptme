---
description: Complete Next.js SEO-friendly website conversion plan for Adopt Me Values app
---

# ADOPT ME VALUES — NEXT.JS WEBSITE CONVERSION MASTER PLAN

> **Source**: React Native app at `/Volumes/Sohail/AI_Projects/adoptme-jan7/`
> **Target**: New Next.js 14+ project at `/Volumes/Sohail/AI_Projects/adoptme-web/`
> **Domain**: adoptmevalues.app
> **Firebase Project**: adoptme-7b50c
> **CDN**: https://adoptme.b-cdn.net

---

## TABLE OF CONTENTS
1. [Project Setup & Tech Stack](#1-project-setup--tech-stack)
2. [Folder Structure](#2-folder-structure)
3. [Configuration & Environment](#3-configuration--environment)
4. [Firebase Web SDK Setup](#4-firebase-web-sdk-setup)
5. [Authentication System](#5-authentication-system)
6. [State Management](#6-state-management)
7. [Theme System (Dark/Light)](#7-theme-system-darklight)
8. [Internationalization (i18n)](#8-internationalization-i18n)
9. [Layout & Navigation](#9-layout--navigation)
10. [PAGE: Values Screen (SEO Core)](#10-page-values-screen-seo-core)
11. [PAGE: Calculator Screen](#11-page-calculator-screen)
12. [PAGE: Trade Section](#12-page-trade-section)
13. [PAGE: Feed / Design Section](#13-page-feed--design-section)
14. [PAGE: Chat System](#14-page-chat-system)
15. [PAGE: Profile Section](#15-page-profile-section)
16. [PAGE: Analytics](#16-page-analytics)
17. [PAGE: News](#17-page-news)
18. [Ads Integration (Google AdSense)](#18-ads-integration-google-adsense)
19. [SEO Implementation](#19-seo-implementation)
20. [Responsive Design System](#20-responsive-design-system)
21. [Deployment](#21-deployment)

---

## 1. PROJECT SETUP & TECH STACK

### 1.1 Create Next.js Project
```bash
cd /Volumes/Sohail/AI_Projects
npx create-next-app@latest adoptme-web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd adoptme-web
```

### 1.2 Install All Dependencies
```bash
# UI Framework
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-avatar @radix-ui/react-tooltip @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-separator
npm install class-variance-authority clsx tailwind-merge
npm install lucide-react
npm install framer-motion
npm install sonner
npm install next-themes

# shadcn/ui (run init then add components)
npx shadcn@latest init
npx shadcn@latest add button card input label tabs dialog dropdown-menu avatar badge separator sheet tooltip switch select textarea popover command scroll-area skeleton

# Firebase (WEB SDK — NOT react-native-firebase)
npm install firebase

# Auth
npm install next-auth@beta @auth/firebase-adapter

# State Management
npm install zustand

# i18n
npm install next-intl

# Data Fetching & Utilities
npm install axios dayjs
npm install leo-profanity

# Charts (for Analytics page)
npm install recharts

# Image handling
npm install html2canvas
npm install sharp

# Analytics
npm install mixpanel-browser

# Misc
npm install react-hot-toast
npm install react-intersection-observer
npm install usehooks-ts
```

### 1.3 Dev Dependencies
```bash
npm install -D @types/node
```

---

## 2. FOLDER STRUCTURE

Create this exact folder structure inside `/Volumes/Sohail/AI_Projects/adoptme-web/`:

```
src/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx            # Login page
│   │   └── register/page.tsx         # Register page
│   ├── (main)/
│   │   ├── layout.tsx                # Main layout with header/footer/nav
│   │   ├── page.tsx                  # Home/Calculator page (default landing)
│   │   ├── values/
│   │   │   ├── page.tsx              # All pets grid with filters (SSG)
│   │   │   └── [slug]/
│   │   │       └── page.tsx          # Individual pet value page (SSG) — SEO GOLD
│   │   ├── calculator/
│   │   │   └── page.tsx              # Trade calculator tool
│   │   ├── trades/
│   │   │   ├── page.tsx              # Trade listings (real-time)
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx          # Single trade detail page
│   │   │   └── create/
│   │   │       └── page.tsx          # Create new trade (auth required)
│   │   ├── feed/
│   │   │   ├── page.tsx              # Design/post feed
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Single post detail
│   │   ├── chat/
│   │   │   ├── page.tsx              # Chat rooms list
│   │   │   ├── [roomId]/
│   │   │   │   └── page.tsx          # Group chat room
│   │   │   └── dm/
│   │   │       └── [userId]/
│   │   │           └── page.tsx      # Private DM
│   │   ├── profile/
│   │   │   ├── page.tsx              # Current user profile (auth required)
│   │   │   └── [userId]/
│   │   │       └── page.tsx          # Public user profile
│   │   ├── analytics/
│   │   │   └── page.tsx              # Market analytics dashboard
│   │   ├── news/
│   │   │   └── page.tsx              # News/updates page
│   │   └── settings/
│   │       └── page.tsx              # User settings
│   ├── admin/
│   │   └── page.tsx                  # Admin dashboard (auth + admin check)
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts  # NextAuth API route
│   │   ├── trades/route.ts              # Trade API
│   │   ├── posts/route.ts               # Feed posts API
│   │   └── revalidate/route.ts          # On-demand ISR revalidation
│   ├── layout.tsx                    # Root layout (providers, meta)
│   ├── globals.css                   # Global styles + Tailwind
│   ├── not-found.tsx                 # Custom 404 page
│   └── sitemap.ts                    # Dynamic sitemap generation
├── components/
│   ├── ui/                           # shadcn/ui components (auto-generated)
│   ├── layout/
│   │   ├── Header.tsx                # Top navigation bar
│   │   ├── Footer.tsx                # Site footer with links
│   │   ├── MobileNav.tsx             # Mobile bottom tab bar
│   │   ├── Sidebar.tsx               # Desktop sidebar nav
│   │   └── LanguageSelector.tsx      # Language picker dropdown
│   ├── auth/
│   │   ├── SignInModal.tsx            # Sign in dialog (Google/Apple/Email)
│   │   ├── UserMenu.tsx              # Logged-in user dropdown
│   │   └── AuthGuard.tsx             # Wrapper for auth-required pages
│   ├── calculator/
│   │   ├── CalculatorBoard.tsx        # Main calculator with has/wants columns
│   │   ├── PetSelector.tsx            # Pet search + select grid
│   │   ├── PetCard.tsx                # Individual pet card in calculator
│   │   ├── TradeResult.tsx            # Win/Lose/Fair result display
│   │   └── ValueBar.tsx              # Visual value comparison bar
│   ├── values/
│   │   ├── PetGrid.tsx               # Grid of all pets with filters
│   │   ├── PetValueCard.tsx          # Pet card showing all value variants
│   │   ├── PetDetailView.tsx         # Full pet detail with chart
│   │   ├── FilterBar.tsx             # Category/rarity/type filters
│   │   └── SearchBar.tsx             # Pet search input
│   ├── trades/
│   │   ├── TradeList.tsx             # List of active trades
│   │   ├── TradeCard.tsx             # Single trade card
│   │   ├── CreateTradeForm.tsx       # Create trade form
│   │   ├── TradeDetail.tsx           # Trade detail view
│   │   ├── ShareTradeButton.tsx      # Share trade via link/social
│   │   └── ReportTradeModal.tsx      # Report a trade
│   ├── feed/
│   │   ├── PostFeed.tsx              # Infinite scroll post feed
│   │   ├── PostCard.tsx              # Single post card
│   │   ├── CreatePostModal.tsx       # Create new post with image
│   │   ├── CommentsSection.tsx       # Comments on a post
│   │   └── ReportPostModal.tsx       # Report a post
│   ├── chat/
│   │   ├── ChatRoomList.tsx          # List of chat rooms
│   │   ├── ChatRoom.tsx              # Chat room with messages
│   │   ├── MessageList.tsx           # Scrollable message list
│   │   ├── MessageInput.tsx          # Text input + send button
│   │   ├── MessageBubble.tsx         # Single message bubble
│   │   ├── OnlineUsers.tsx           # Online users sidebar
│   │   ├── PrivateChat.tsx           # DM chat view
│   │   ├── CreateGroupModal.tsx      # Create new group
│   │   └── ChatHeader.tsx            # Chat room header
│   ├── profile/
│   │   ├── ProfileHeader.tsx         # User avatar, name, stats
│   │   ├── ProfileTrades.tsx         # User's trade history
│   │   ├── ProfilePosts.tsx          # User's feed posts
│   │   ├── EditProfileModal.tsx      # Edit display name/avatar
│   │   └── BlockedUsersList.tsx      # Manage blocked users
│   ├── analytics/
│   │   ├── AnalyticsDashboard.tsx    # Main analytics view
│   │   ├── TrendChart.tsx            # Value trend line chart
│   │   ├── TopPetsTable.tsx          # Most traded/demanded pets
│   │   ├── ValueChangesCard.tsx      # Recent value changes
│   │   └── SupplyDemandChart.tsx     # Supply vs demand visualization
│   ├── shared/
│   │   ├── PetImage.tsx              # Optimized pet image component
│   │   ├── AdBanner.tsx              # Google AdSense banner
│   │   ├── LoadingSpinner.tsx        # Loading indicator
│   │   ├── EmptyState.tsx            # Empty state placeholder
│   │   ├── ErrorBoundary.tsx         # Error boundary wrapper
│   │   ├── InfiniteScroll.tsx        # Infinite scroll wrapper
│   │   ├── ConfirmDialog.tsx         # Confirmation dialog
│   │   ├── ReportButton.tsx          # Generic report button
│   │   └── ProBadge.tsx              # Pro user badge
│   └── seo/
│       ├── JsonLd.tsx                # JSON-LD structured data component
│       └── MetaTags.tsx              # Dynamic meta tags helper
├── lib/
│   ├── firebase/
│   │   ├── config.ts                 # Firebase app initialization
│   │   ├── auth.ts                   # Auth helper functions
│   │   ├── firestore.ts             # Firestore queries
│   │   ├── database.ts              # Realtime Database queries
│   │   └── storage.ts               # Firebase Storage helpers
│   ├── store/
│   │   ├── useAuthStore.ts           # Zustand: auth state
│   │   ├── useLocalStore.ts          # Zustand: local preferences (persisted)
│   │   ├── useTradeStore.ts          # Zustand: trade calculator state
│   │   └── useChatStore.ts           # Zustand: chat state
│   ├── hooks/
│   │   ├── useFirebaseAuth.ts        # Firebase auth hook
│   │   ├── useRealtimeData.ts        # RTDB listener hook
│   │   ├── useFirestoreQuery.ts      # Firestore query hook
│   │   ├── usePetData.ts             # Pet data from CDN hook
│   │   ├── usePresence.ts            # Online presence hook
│   │   ├── useMediaQuery.ts          # Responsive breakpoint hook
│   │   └── useDebounce.ts            # Debounce hook
│   ├── utils/
│   │   ├── petHelpers.ts             # Pet value calculation logic
│   │   ├── tradeHelpers.ts           # Trade win/lose/fair logic
│   │   ├── formatters.ts             # Number/date formatting
│   │   ├── contentModeration.ts      # Profanity filter (leo-profanity)
│   │   ├── slugify.ts                # Pet name to URL slug
│   │   └── cn.ts                     # Tailwind classname merge utility
│   ├── constants/
│   │   ├── config.ts                 # App config (colors, URLs, etc.)
│   │   ├── petCategories.ts          # Pet type/rarity constants
│   │   └── adUnits.ts                # AdSense unit IDs
│   └── types/
│       ├── pet.ts                    # Pet data types
│       ├── trade.ts                  # Trade data types
│       ├── user.ts                   # User data types
│       ├── post.ts                   # Feed post types
│       ├── chat.ts                   # Chat/message types
│       └── analytics.ts             # Analytics data types
├── messages/
│   ├── en.json                       # English translations (copy from RN app)
│   ├── es.json                       # Spanish translations
│   ├── fr.json                       # French translations
│   ├── de.json                       # German translations
│   └── ar.json                       # Arabic translations
└── public/
    ├── images/
    │   ├── logo.webp                 # App logo
    │   ├── icon.webp                 # Favicon source
    │   ├── og-image.png              # Default OpenGraph image (1200x630)
    │   └── pets/                     # Pet images (if self-hosted, otherwise CDN)
    ├── fonts/                        # Custom fonts if any
    ├── robots.txt                    # SEO robots file
    └── manifest.json                 # PWA manifest
```

---

## 3. CONFIGURATION & ENVIRONMENT

### 3.1 Create `src/lib/constants/config.ts`
Port from RN `Code/Helper/Environment.js`. Remove all mobile-specific config.

```typescript
export const config = {
  appName: 'Adopt Me Values Calculator',
  domain: 'https://adoptmevalues.app',
  supportEmail: 'thesolanalabs@gmail.com',

  // Firebase
  cloudFunctionsUrl: 'https://us-central1-adoptme-7b50c.cloudfunctions.net',

  // CDN
  cdnBaseUrl: 'https://adoptme.b-cdn.net',
  petDataUrl: 'https://adoptme.b-cdn.net',
  tradeAnalyticsUrl: 'https://adoptme.b-cdn.net/trade_analytics.json',
  valueChangesUrl: 'https://adoptme.b-cdn.net/value_changes.json',

  // App Links
  androidLink: 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc',
  iosLink: 'https://apps.apple.com/us/app/app-name/id6745400111',

  // Theme Colors
  colors: {
    primary: '#ff6666',
    secondary: '#3E8BFC',
    hasBlockGreen: 'rgb(255, 102, 102)',
    wantBlockRed: '#66b266',
    backgroundLight: '#f2f2f7',
    backgroundDark: '#121212',
  },

  // Cache durations (ms)
  cache: {
    petData: 3 * 60 * 1000,        // 3 minutes
    analytics: 3 * 60 * 60 * 1000,  // 3 hours
    valueChanges: 1 * 60 * 60 * 1000, // 1 hour
    serverLink: 3 * 60 * 60 * 1000,   // 3 hours
  },

  // Admin emails
  adminEmails: [
    'thesolanalabs@gmail.com',
    'sohailnasir74business@gmail.com',
    'sohailnasir74@gmail.com',
  ],
} as const;
```

### 3.2 Create `.env.local`
```
# Firebase Web Config (from Firebase Console > Project Settings > Web App)
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=adoptme-7b50c.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=adoptme-7b50c
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=adoptme-7b50c.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=541413670501
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://adoptme-7b50c-default-rtdb.firebaseio.com
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_measurement_id

# NextAuth
NEXTAUTH_SECRET=generate_a_random_secret_here
NEXTAUTH_URL=http://localhost:3000

# Google OAuth (same webClientId as RN app)
GOOGLE_CLIENT_ID=541413670501-aj1f61kv0k9f3v515tsu3768ef9hpfjt.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Google AdSense
NEXT_PUBLIC_ADSENSE_CLIENT_ID=ca-pub-1340655056171083

# Mixpanel
NEXT_PUBLIC_MIXPANEL_TOKEN=your_mixpanel_token
```

---

## 4. FIREBASE WEB SDK SETUP

### 4.1 Create `src/lib/firebase/config.ts`
```typescript
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const database = getDatabase(app);
export default app;
```

### 4.2 Key Firebase Data Structures (from existing RN app)

**Realtime Database paths:**
- `users/{uid}` — User profile: `{ id, displayName, avatar, isBlock, fcmToken, lastactivity, online, isPro, email, decodedEmail, flage, createdAt }`
- `presence/{uid}` — Boolean online status (separate node for scalability)
- `server` — Trading server links: `{ [id]: { link, ... } }`
- `api` — Google Translate API key
- `free_translation` — Free translation flag
- `single_offer_wall` — Paywall flag
- `image_url` — Shared CDN image base URL

**Firestore collections:**
- `trades_new` — Trade documents: `{ userId, traderName, avatar, hasItems[], wantsItems[], hasItemNames[], wantsItemNames[], hasTotal, wantsTotal, status ('w'/'l'/'f'), timestamp, isFeatured, description, isPro, isSharkMode, rating, ratingCount }`
- Each trade item: `{ name, type, valueType, isFly, isRide, image }`
- `reviews/{userId}` — `{ ownedPets[], wishlistPets[] }` (supply/demand signals)
- `trade_analytics/latest` — Aggregated analytics data
- `posts` (or similar) — Feed/design posts

**CDN data:**
- `https://adoptme.b-cdn.net` — Main pet data JSON (all pets with values)
- `https://adoptme.b-cdn.net/trade_analytics.json` — Trade analytics
- `https://adoptme.b-cdn.net/value_changes.json` — Value changes (multi-value: d/n/m × nopotion/fly/ride/flyride, keys like `d_nopotion`, `n_flyride`)

---

## 5. AUTHENTICATION SYSTEM

### 5.1 Create `src/lib/firebase/auth.ts`
Port the auth logic from `Code/Firebase/SigninDrawer.jsx` and `Code/GlobelStats.js`.

**Supported auth methods:**
1. **Google Sign-In** — Use `signInWithPopup(auth, googleProvider)` (web SDK popup flow)
2. **Email/Password** — Use `signInWithEmailAndPassword`, `createUserWithEmailAndPassword`
3. **Apple Sign-In** — Use `signInWithPopup(auth, appleProvider)` (only show on Safari/Apple devices)
4. **Password Reset** — Use `sendPasswordResetEmail`

**Auth flow (from GlobelStats.js lines 208-303):**
1. On auth state change (`onAuthStateChanged`):
   - If user exists in RTDB `users/{uid}`, load their data
   - If new user, create with `createNewUser()` shape (from `Globelhelper.js` line 168-189):
     ```
     { id, displayName, avatar (default placeholder), isBlock: false, fcmToken: null, lastactivity: null, online: false, isPro: false, email, decodedEmail, createdAt: Date.now() }
     ```
   - Check admin status: email in `['thesolanalabs@gmail.com', 'sohailnasir74business@gmail.com', 'sohailnasir74@gmail.com']`
   - Email verification required for email/password sign-ups

### 5.2 Create `src/components/auth/SignInModal.tsx`
- Modal/dialog with tabs: Sign In / Register / Forgot Password
- Google Sign-In button (always visible)
- Apple Sign-In button (only on Apple devices — check `navigator.userAgent`)
- Email + Password form
- Roblox username optional field (on register)
- Use shadcn Dialog + Form components
- Port UI from `Code/Firebase/SigninDrawer.jsx`

### 5.3 Create `src/components/auth/AuthGuard.tsx`
- Wrapper component for auth-required pages
- If not logged in, show SignInModal
- Used on: create trade, create post, chat, profile, settings

---

## 6. STATE MANAGEMENT

### 6.1 Zustand Stores (replace RN Context + MMKV)

**`src/lib/store/useAuthStore.ts`** — Port from `GlobelStats.js`
```typescript
interface AuthState {
  user: User | null;          // From RTDB users/{uid}
  isAdmin: boolean;
  theme: 'light' | 'dark' | 'system';
  isLoading: boolean;
  api: string | null;         // Google Translate API key
  freeTranslation: boolean;
  tradingServerLink: string | null;
  // Actions
  setUser: (user: User | null) => void;
  setTheme: (theme: string) => void;
  updateUser: (updates: Partial<User>) => void;
  logout: () => void;
}
```

**`src/lib/store/useLocalStore.ts`** — Port from `LocalGlobelStats.js`
Uses `zustand/middleware` with `persist` (localStorage instead of MMKV):
```typescript
interface LocalState {
  isPro: boolean;
  data: Record<string, any>;     // Pet data from CDN
  favorites: string[];            // Favorite pet names
  bannedUsers: string[];          // Blocked user IDs
  theme: 'light' | 'dark' | 'system';
  fetchDataTime: string | null;
  translationUsage: { count: number; date: string };
  postsCache: any[];
  tradingServerLink: string | null;
  lastServerFetch: string | null;
  // Actions
  updateLocalState: (key: string, value: any) => void;
  clearAll: () => void;
}
```

**`src/lib/store/useTradeStore.ts`** — Calculator state
```typescript
interface TradeState {
  hasItems: PetItem[];      // Left side items
  wantsItems: PetItem[];    // Right side items
  hasTotal: number;
  wantsTotal: number;
  result: 'w' | 'l' | 'f' | null;  // win/lose/fair
  // Actions
  addHasItem: (item: PetItem) => void;
  addWantsItem: (item: PetItem) => void;
  removeHasItem: (index: number) => void;
  removeWantsItem: (index: number) => void;
  clearAll: () => void;
  calculateResult: () => void;
}
```

**`src/lib/store/useChatStore.ts`** — Chat state
```typescript
interface ChatState {
  activeRoom: string | null;
  messages: Message[];
  onlineUsers: Record<string, boolean>;
  // Actions
  setActiveRoom: (roomId: string) => void;
  addMessage: (msg: Message) => void;
  setOnlineUsers: (users: Record<string, boolean>) => void;
}
```

---

## 7. THEME SYSTEM (DARK/LIGHT)

### 7.1 Setup `next-themes`
In root layout, wrap with `ThemeProvider` from `next-themes`.

Port the theme logic from `GlobelStats.js` lines 28-84:
- Support: `light`, `dark`, `system`
- Store preference in localStorage (replaces MMKV `theme` key)
- Default to `system`
- Colors from `config.colors`:
  - Primary: `#ff6666`
  - Secondary: `#3E8BFC`
  - Has block: `rgb(255, 102, 102)`
  - Want block: `#66b266`

### 7.2 Tailwind Config
Add custom colors to `tailwind.config.ts`:
```
colors: {
  primary: '#ff6666',
  secondary: '#3E8BFC',
  'has-green': 'rgb(255, 102, 102)',
  'want-red': '#66b266',
}
```
Use CSS variables for dark mode toggle.

---

## 8. INTERNATIONALIZATION (i18n)

### 8.1 Setup `next-intl`
Port from `i18n.js` in RN app.

**Supported languages** (from `i18n.js` line 28):
- `en` — English (default, fallback)
- `es` — Spanish
- `fr` — French
- `de` — German
- `ar` — Arabic (RTL support needed!)

### 8.2 Copy Translation Files
Copy these files from `Code/Translation/` to `src/messages/`:
- `en.json` (47,948 bytes)
- `es.json` (49,532 bytes)
- `fr.json` (54,235 bytes)
- `de.json` (53,247 bytes)
- `ar.json` (62,833 bytes)

### 8.3 URL Structure for SEO
Use locale prefix in URLs for SEO:
- `adoptmevalues.app/en/values/shadow-dragon`
- `adoptmevalues.app/es/values/shadow-dragon`
- `adoptmevalues.app/fr/values/shadow-dragon`

This gives each language its own indexable URL.

### 8.4 Language Selector
Port from `MainTabs.js` lines 162-202:
- Dropdown in header showing flag + language code
- Available languages with flags: 🇺🇸 EN, 🇪🇸 ES, 🇫🇷 FR, 🇩🇪 DE, 🇸🇦 AR
- Switching language changes URL prefix

---

## 9. LAYOUT & NAVIGATION

### 9.1 Root Layout (`src/app/layout.tsx`)
- `<html>` with lang attribute from locale
- Providers: ThemeProvider, next-intl, Zustand (no provider needed), Sonner toaster
- Global meta tags, favicon, fonts

### 9.2 Main Layout (`src/app/(main)/layout.tsx`)
Responsive layout with:

**Desktop (≥1024px):**
- Top header bar (logo, search, language, theme toggle, user menu)
- Main content area
- Footer

**Tablet (768px-1023px):**
- Top header bar (compact)
- Main content area
- Bottom tab bar (like mobile app)

**Mobile (<768px):**
- Top header bar (hamburger menu + logo + user avatar)
- Main content area
- Bottom tab bar with 5 tabs (matches RN app exactly)

### 9.3 Header Component (`src/components/layout/Header.tsx`)
Port from `MainTabs.js` header options:
- **Left**: Logo + App name (link to home)
- **Center**: Search bar (desktop only)
- **Right**: Language selector, theme toggle, Analytics link (with "NEW" badge), user avatar/login button
- Admin button (trophy icon) if user is admin
- Mobile: hamburger → sheet with nav links

### 9.4 Bottom Tab Bar (`src/components/layout/MobileNav.tsx`)
Port from `MainTabs.js` Tab.Navigator (lines 226-358):
- **Calculator** tab → `/calculator` (calculator icon)
- **Trade** tab → `/trades` (handshake icon)
- **Feed** tab → `/feed` (house icon)
- **Chat** tab → `/chat` (envelope icon)
- **More** tab → `/values` (angles-right icon)

Use `lucide-react` icons to match FontAwesome6 icons used in RN app.
Show active tab highlight with primary color background (dark: `#5c4c49`, light: `#f3d0c7`).

### 9.5 Footer Component (`src/components/layout/Footer.tsx`)
- App links (Google Play, App Store)
- Quick links (Values, Calculator, Trades, News, Analytics)
- Support email
- Copyright
- Social links
- SEO-rich internal links

---

## 10. PAGE: VALUES SCREEN (SEO CORE) ⭐ HIGHEST PRIORITY

This is the #1 SEO opportunity. Each pet gets its own indexable page.

### 10.1 Data Source
Pet data is fetched from CDN: `https://adoptme.b-cdn.net`
This returns a JSON object where keys are category names and values are arrays of pets.

Port the data fetching logic from `GlobelStats.js` lines 431-497 (`fetchStockData`).

### 10.2 Pet Data Types (`src/lib/types/pet.ts`)
```typescript
interface Pet {
  name: string;
  image: string;         // CDN URL to pet image
  type: string;          // e.g., 'Legendary', 'Ultra-Rare', 'Rare', 'Uncommon', 'Common'
  category: string;      // e.g., 'Pets', 'Neon Pets', 'Mega Neon'
  // Values — multi-variant (d=default, n=neon, m=mega × potion variants)
  d_nopotion?: number;   // Default no potion value
  d_fly?: number;        // Default fly value
  d_ride?: number;       // Default ride value
  d_flyride?: number;    // Default fly-ride value
  n_nopotion?: number;   // Neon no potion
  n_fly?: number;
  n_ride?: number;
  n_flyride?: number;
  m_nopotion?: number;   // Mega neon no potion
  m_fly?: number;
  m_ride?: number;
  m_flyride?: number;
  demand?: string;       // e.g., 'High', 'Medium', 'Low'
  stable?: boolean;      // Value stability
}
```

### 10.3 All Values Page (`src/app/(main)/values/page.tsx`)
**Route**: `/values`
**Rendering**: SSG with ISR (revalidate every 5 minutes)

Features:
- Hero section: "Adopt Me Pet Values — Updated Daily"
- **Search bar** — Filter pets by name (port from `Code/Helper/searchHelper.js`)
- **Filter buttons** — By type (Legendary, Ultra-Rare, Rare, etc.), by category
- **Sort options** — By value (high to low), by name (A-Z), by demand
- **Pet grid** — Responsive grid of PetValueCard components
  - Mobile: 2 columns
  - Tablet: 3 columns
  - Desktop: 4-5 columns
- Each card links to `/values/[slug]`
- Pagination or "Load More" (start with showing top 50, load more on scroll)

### 10.4 Individual Pet Value Page (`src/app/(main)/values/[slug]/page.tsx`) ⭐⭐⭐
**Route**: `/values/shadow-dragon`, `/values/frost-dragon`, etc.
**Rendering**: SSG with `generateStaticParams()` for ALL pets at build time

This is the MOST important page for SEO. Each pet gets a unique URL.

**Content to include:**
1. **Pet hero**: Large pet image, name, type badge, demand badge
2. **Value table**: All value variants in a clean table
   - Columns: No Potion, Fly, Ride, Fly-Ride
   - Rows: Normal, Neon, Mega Neon
3. **Value history chart** (from value_changes.json if available)
4. **Demand indicator**: High/Medium/Low with visual bar
5. **Similar pets**: Links to pets with similar values (internal linking = SEO gold)
6. **"Use in Calculator"** CTA button → pre-loads pet in calculator
7. **Breadcrumbs**: Home > Values > [Pet Name]

**SEO for this page:**
```typescript
export async function generateMetadata({ params }): Promise<Metadata> {
  return {
    title: `${petName} Value — Adopt Me Trading Values 2025`,
    description: `Check the latest ${petName} value in Adopt Me. Current value: ${value}. See Neon, Mega, Fly, Ride prices and demand.`,
    openGraph: {
      title: `${petName} Value | Adopt Me Values`,
      description: `${petName} is worth ${value}. Demand: ${demand}.`,
      images: [petImageUrl],
    },
    alternates: {
      canonical: `https://adoptmevalues.app/values/${slug}`,
      languages: { en: `/en/values/${slug}`, es: `/es/values/${slug}`, fr: `/fr/values/${slug}`, de: `/de/values/${slug}`, ar: `/ar/values/${slug}` },
    },
  };
}
```

**JSON-LD Structured Data:**
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Shadow Dragon — Adopt Me",
  "description": "Shadow Dragon pet value in Adopt Me Roblox",
  "image": "https://...",
  "offers": {
    "@type": "Offer",
    "price": "150",
    "priceCurrency": "GAME_VALUE"
  }
}
```

### 10.5 `generateStaticParams()`
Fetch all pet data from CDN at build time, generate a slug for each pet:
```typescript
export async function generateStaticParams() {
  const data = await fetch('https://adoptme.b-cdn.net').then(r => r.json());
  const allPets = Object.values(data).flat();
  return allPets.map(pet => ({ slug: slugify(pet.name) }));
}
```

### 10.6 Slug Helper (`src/lib/utils/slugify.ts`)
```typescript
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
```

---

## 11. PAGE: CALCULATOR SCREEN

### 11.1 Route: `/calculator` (also the home page `/`)
**Rendering**: Client-side (interactive tool, no SSR needed for the tool itself, but SSR the shell for SEO)

Port from `Code/Homescreen/HomeScreen.jsx` (2,394 lines) — the core feature.

### 11.2 Calculator Layout
Two-column layout (has/wants):
- **Left column ("Has" / "Offering")**: Red/coral background (`config.colors.hasBlockGreen`)
- **Right column ("Wants" / "Looking For")**: Green background (`config.colors.wantBlockRed`)
- **Center**: Swap arrow button, total values display, result (Win/Lose/Fair)

### 11.3 Features to Port
1. **Pet selector modal**: Search pets by name, click to add to Has or Wants
2. **Pet cards in columns**: Show pet image, name, value. Can toggle Fly/Ride/Neon/Mega
3. **Value calculation**: Sum values on each side, compare
4. **Result display**: 
   - Win (green) — user gets more value
   - Lose (red) — user gives more value
   - Fair (yellow) — roughly equal
   - Show percentage difference
5. **Share trade**: Generate shareable image/link
6. **Reset button**: Clear both sides
7. **Favorites**: Quick-add favorite pets

### 11.4 SEO Shell
Even though the calculator is client-side, wrap it in server-rendered SEO content:
```
<h1>Adopt Me Trade Calculator — Check if Your Trade is Fair</h1>
<p>Use our free Adopt Me trade calculator to check pet values and see if your trade is a win, lose, or fair. Updated daily with the latest values.</p>
[Calculator Tool - client component]
<h2>How to Use the Adopt Me Calculator</h2>
<p>Step by step instructions...</p>
<h2>Frequently Asked Questions</h2>
...FAQ schema markup...
```

---

## 12. PAGE: TRADE SECTION

### 12.1 Routes
- `/trades` — Trade listings (SSR with real-time updates)
- `/trades/[id]` — Individual trade detail (SSR + real-time)
- `/trades/create` — Create new trade (client-side, auth required)

### 12.2 Data Source
Firestore collection: `trades_new`

Trade document structure (from memory):
```typescript
interface Trade {
  id: string;                // Firestore doc ID
  userId: string;
  traderName: string;
  avatar: string;
  hasItems: TradeItem[];     // What they're offering
  wantsItems: TradeItem[];   // What they want
  hasItemNames: string[];
  wantsItemNames: string[];
  hasTotal: number;
  wantsTotal: number;
  status: 'w' | 'l' | 'f';  // win/lose/fair
  timestamp: Timestamp;
  isFeatured: boolean;
  description: string;
  isPro: boolean;
  isSharkMode: boolean;
  rating: number;
  ratingCount: number;
}

interface TradeItem {
  name: string;
  type: string;
  valueType: string;
  isFly: boolean;
  isRide: boolean;
  image: string;
}
```

### 12.3 Trade Listings Page (`/trades`)
Port from `Code/Trades/Trades.jsx` (1,947 lines):

Features:
- **Filter tabs**: All, Featured, Win, Lose, Fair, Shark Mode
- **Trade cards**: Show trader name, avatar, has items → wants items, value comparison, rating
- **Real-time updates**: Use Firestore `onSnapshot` for live trade feed
- **Create trade CTA**: Button to create new trade (opens `/trades/create`)
- **Pagination**: Infinite scroll with Firestore cursor pagination
- **Report button**: Report inappropriate trades

### 12.4 Single Trade Page (`/trades/[id]`)
Port from `Code/Trades/ShareTradeModal.js`:

- Full trade detail with larger pet images
- Value breakdown for each side
- Comment/rate the trade
- Share buttons (copy link, Twitter, etc.)
- SEO meta tags with trade summary

### 12.5 Create Trade Page (`/trades/create`)
Port from trade creation flow in `Trades.jsx`:

- Auth required (show SignInModal if not logged in)
- Two-column pet selector (Has / Wants)
- Description field
- Featured toggle (Pro only)
- Submit to Firestore `trades_new`

### 12.6 Trade Notification System
Port from `Code/Trades/Notifier.js`:
- On web, use browser Notification API (optional)
- Show toast notifications for trade activity

---

## 13. PAGE: FEED / DESIGN SECTION

### 13.1 Routes
- `/feed` — Post feed with infinite scroll
- `/feed/[id]` — Single post detail

### 13.2 Port from `Code/Design/DesignMainScreen.js` (19,011 bytes)

Features:
1. **Post feed**: Infinite scroll grid of user posts
2. **Post card** (port from `Code/Design/componenets/PostCard.js`):
   - User avatar + name
   - Post image
   - Like count, comment count
   - Time ago
3. **Create post** (port from `Code/Design/componenets/UploadModal.js`):
   - Auth required
   - Image upload (use `<input type="file">` + Next.js API route for upload)
   - Caption text
   - Submit to Firestore
4. **Comments** (port from `Code/Design/componenets/CommentsModal.js`):
   - Threaded comments
   - Profanity filter (leo-profanity)
5. **Report** (port from `Code/Design/componenets/ReportModal.js`):
   - Report inappropriate posts/comments

### 13.3 Image Handling
- RN uses `react-native-image-picker` + `react-native-compressor`
- Web: Use `<input type="file" accept="image/*">` + client-side resize with Canvas API
- Upload to Firebase Storage or use existing CDN workflow
- Display with `next/image` for optimization

---

## 14. PAGE: CHAT SYSTEM

### 14.1 Routes
- `/chat` — Chat rooms list + community chat
- `/chat/[roomId]` — Specific group chat room
- `/chat/dm/[userId]` — Private DM with specific user

### 14.2 This is the MOST COMPLEX section
Port from `Code/ChatScreen/` (28 files, ~10,000+ lines):

### 14.3 Group Chat
Port from `Code/ChatScreen/GroupChat/GroupsScreen.jsx` (2,086 lines) and `GroupChatScreen.jsx` (1,308 lines):

**Chat Room List:**
- List of available group chat rooms
- Show room name, member count, last message preview
- Online users count indicator
- Create new group button (auth required)

**Chat Room View:**
- Message list with infinite scroll (older messages load on scroll up)
- Real-time messages via Firebase RTDB `onValue` listeners
- Message input with text field + send button
- Each message: avatar, username, timestamp, text, optional image
- Online users sidebar (desktop) / drawer (mobile)
- Port from `Code/ChatScreen/GroupChat/MessagesList.jsx` and `Code/ChatScreen/GroupChat/MessageInput.jsx`

**Online Users:**
Port from `Code/ChatScreen/GroupChat/OnlineUsersList.jsx` (1,188 lines):
- List of currently online users
- Click to open DM
- Show user avatar, name, flag, online indicator
- Presence tracked via RTDB `presence/{uid}` node

### 14.4 Private Chat (DM)
Port from `Code/ChatScreen/PrivateChat/PrivateChat.jsx` (1,101 lines):
- One-on-one messaging
- Message list with real-time updates
- Image sharing
- Block/unblock user
- Scam warning display (from `Code/ChatScreen/PrivateChat/Scamwarning.js`)

### 14.5 Online Presence for Web
Port from `GlobelStats.js` lines 518-661:
- Use Firebase RTDB `presence/{uid}` node
- Set to `true` when page is visible, `false` on page hide
- Use `document.addEventListener('visibilitychange', ...)` instead of AppState
- Use `.info/connected` + `onDisconnect().set(false)` for crash recovery
- Throttle updates (500ms minimum between writes)

### 14.6 Content Moderation
Port from `Code/Helper/ContentModeration.js`:
- Use `leo-profanity` for real-time message filtering
- Block reported users from sending messages

---

## 15. PAGE: PROFILE SECTION

### 15.1 Routes
- `/profile` — Current user's own profile (auth required)
- `/profile/[userId]` — Public profile of any user

### 15.2 Current User Profile (`/profile`)
Port from `Code/SettingScreen/Setting.jsx` (4,012 lines — take only profile-relevant parts):

**Profile Header:**
- User avatar (editable)
- Display name (editable)
- Email (read-only)
- Pro badge if subscriber
- Country flag (if user enabled `showFlag`)
- Online status indicator
- Member since date

**Profile Sections:**
1. **My Trades**: List of user's trades from `trades_new` where `userId == currentUser.id`
2. **My Posts**: List of user's feed posts
3. **Favorites**: User's favorite pets list
4. **Owned Pets**: From `reviews/{userId}.ownedPets[]`
5. **Wishlist**: From `reviews/{userId}.wishlistPets[]`

**Profile Actions:**
- Edit profile (change name, avatar)
- Toggle dark/light/system theme
- Change language
- Toggle online status visibility (`showOnlineStatus`)
- Toggle country flag visibility (`showFlag`)
- View blocked users list
- Logout button
- Delete account option

### 15.3 Public User Profile (`/profile/[userId]`)
- Read-only view of another user's profile
- Show their trades and posts
- "Send Message" button → opens DM
- "Block User" button
- "Report User" button

### 15.4 Edit Profile
Port from `Code/SettingScreen/EditProfileModal.js`:
- Modal with avatar upload + display name field
- Avatar: use `<input type="file">` for upload
- Save to RTDB `users/{uid}` with `update()`

---

## 16. PAGE: ANALYTICS

### 16.1 Route: `/analytics`
**Rendering**: SSG with ISR (revalidate every hour)

Port from `Code/Analytics/AnalyticsScreen.js` (1,539 lines).

### 16.2 Data Sources
- **Trade analytics**: `https://adoptme.b-cdn.net/trade_analytics.json`
- **Value changes**: `https://adoptme.b-cdn.net/value_changes.json`
- Both cached in MMKV (now localStorage) — analytics 3hr, changes 1hr

### 16.3 Dashboard Sections
1. **Market Overview**: Total trades, average values, trending up/down counts
2. **Top Traded Pets**: Bar chart of most frequently traded pets
3. **Value Changes**: Table showing recent pet value increases/decreases with % change
4. **Demand Heatmap**: Supply vs demand visualization
5. **Trade Volume Chart**: Line chart of trade volume over time

Use `recharts` library for all charts.

### 16.4 SEO
```
<h1>Adopt Me Market Analytics — Pet Trading Trends 2025</h1>
<p>Live analytics on Adopt Me pet trading. See which pets are trending, value changes, and market demand.</p>
```

---

## 17. PAGE: NEWS

### 17.1 Route: `/news`
**Rendering**: SSR or SSG with ISR

Port from `Code/ValuesScreen/News.js` (807 lines):
- News/update articles
- Each article: title, date, content, image
- Chronological order
- SEO-friendly with proper heading structure

---

## 18. ADS INTEGRATION (GOOGLE ADSENSE)

### 18.1 Replace Mobile Ads with Web Ads
RN app uses Google AdMob. Web uses Google AdSense.

**Ad placements:**
1. **Header banner** — 728x90 leaderboard (desktop), 320x50 mobile banner
2. **Between content** — In-feed ads in trade list and feed
3. **Sidebar** — 300x250 rectangle (desktop only)
4. **Below calculator** — 728x90 or responsive

### 18.2 Create `src/components/shared/AdBanner.tsx`
- Responsive ad component
- Show only for non-Pro users (check `isPro` from store)
- Load AdSense script in root layout `<head>`
- Use `data-ad-slot` for each placement

### 18.3 Pro Users
- Pro users see no ads (same as RN app)
- For web, Pro status can be checked from Zustand store
- Consider adding Stripe for web subscriptions (future enhancement)

---

## 19. SEO IMPLEMENTATION ⭐

### 19.1 Sitemap (`src/app/sitemap.ts`)
Dynamic sitemap generation:
```typescript
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages = ['/', '/values', '/calculator', '/trades', '/feed', '/chat', '/analytics', '/news'];

  // Dynamic pet pages (fetch all pets from CDN)
  const petData = await fetch('https://adoptme.b-cdn.net').then(r => r.json());
  const allPets = Object.values(petData).flat();
  const petPages = allPets.map(pet => ({
    url: `https://adoptmevalues.app/values/${slugify(pet.name)}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  return [...staticPages.map(p => ({
    url: `https://adoptmevalues.app${p}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: p === '/' ? 1.0 : 0.9,
  })), ...petPages];
}
```

### 19.2 Robots.txt (`public/robots.txt`)
```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin/
Disallow: /chat/dm/
Sitemap: https://adoptmevalues.app/sitemap.xml
```

### 19.3 Meta Tags for Every Page
Every page must have:
- `<title>` — Unique, keyword-rich, under 60 chars
- `<meta name="description">` — Unique, under 160 chars
- `<link rel="canonical">` — Self-referencing canonical
- `<meta property="og:*">` — OpenGraph for social sharing
- `<meta name="twitter:*">` — Twitter card
- `<link rel="alternate" hreflang="*">` — For each language variant
- JSON-LD structured data where applicable

### 19.4 Key SEO Pages & Their Titles
| Page | Title Format |
|------|-------------|
| Home | `Adopt Me Values Calculator — Free Trade Checker 2025` |
| Values | `All Adopt Me Pet Values — Updated Daily [Month 2025]` |
| Pet Detail | `[Pet Name] Value in Adopt Me — Neon, Mega, Fly, Ride Prices` |
| Calculator | `Adopt Me Trade Calculator — Is Your Trade Fair?` |
| Trades | `Adopt Me Trading — Find Trades & Trade Pets` |
| Analytics | `Adopt Me Market Analytics — Pet Value Trends` |
| News | `Adopt Me News & Updates — Latest Value Changes` |

### 19.5 Internal Linking Strategy
- Every pet page links to 5-10 similar-value pets
- Calculator page links to top pets
- Trade pages link to involved pets' value pages
- News articles link to affected pets
- Footer has links to all major categories

### 19.6 Performance (Core Web Vitals)
- Use `next/image` for all images with proper `width`, `height`, `alt`
- Use `loading="lazy"` for below-fold images
- Minimize JavaScript bundle with dynamic imports
- Use `next/font` for fonts
- Target: LCP < 2.5s, FID < 100ms, CLS < 0.1

---

## 20. RESPONSIVE DESIGN SYSTEM

### 20.1 Breakpoints (Tailwind defaults)
```
sm: 640px    (large phone landscape)
md: 768px    (tablet portrait)
lg: 1024px   (tablet landscape / small desktop)
xl: 1280px   (desktop)
2xl: 1536px  (large desktop)
```

### 20.2 Layout Behavior

**Mobile (< 768px):**
- Single column layout
- Bottom tab navigation (5 tabs matching app)
- Hamburger menu for secondary nav
- Full-width cards
- Touch-friendly tap targets (min 44px)
- Pet grid: 2 columns
- Chat: full-screen view
- Trade cards: stacked (has items → wants items vertically)

**Tablet (768px - 1023px):**
- Single column with more breathing room
- Bottom tab navigation
- Pet grid: 3 columns
- Chat: split view (room list + chat)
- Trade cards: side-by-side (has | wants)

**Desktop (≥ 1024px):**
- Multi-column layouts where appropriate
- Top navigation (no bottom tabs)
- Sidebar for chat rooms
- Pet grid: 4-5 columns
- Chat: three-panel (rooms | messages | online users)
- Trade cards: full horizontal layout

### 20.3 Component Responsiveness Rules
- All components must use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`)
- No fixed pixel widths on containers — use `max-w-*` + `mx-auto`
- Images: always have `width` and `height` or use `fill` with `object-cover`
- Text: base size 14-16px, scale up on desktop
- Touch targets: minimum 44x44px on mobile
- Modals: full-screen on mobile, centered dialog on desktop

---

## 21. DEPLOYMENT

### 21.1 Platform: Vercel (recommended for Next.js)
```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel --prod
```

### 21.2 Environment Variables
Set all `.env.local` variables in Vercel dashboard.

### 21.3 Custom Domain
Point `adoptmevalues.app` to Vercel.

### 21.4 Firebase Security Rules
Add the web app domain to Firebase authorized domains:
- Firebase Console > Authentication > Settings > Authorized domains
- Add `adoptmevalues.app` and `adoptme-web.vercel.app`

---

## EXECUTION ORDER (Step by Step)

Follow this exact order. Each step should be completed fully before moving to the next.

### PHASE 1: Foundation (Do first, everything depends on this)
1. Create Next.js project with all dependencies
2. Set up folder structure
3. Create `config.ts`, `.env.local`
4. Set up Firebase web SDK (`src/lib/firebase/config.ts`)
5. Set up Tailwind config with custom colors
6. Set up `next-themes` for dark/light mode
7. Set up `next-intl` with all 5 translation files
8. Create TypeScript types (`src/lib/types/*.ts`)
9. Create utility functions (`slugify`, `cn`, `formatters`, `petHelpers`, `tradeHelpers`)
10. Create Zustand stores (`useAuthStore`, `useLocalStore`, `useTradeStore`, `useChatStore`)

### PHASE 2: Layout & Auth (Needed by all pages)
11. Create root layout with providers
12. Create Header component (responsive)
13. Create MobileNav bottom tab bar
14. Create Footer component
15. Create main layout (`(main)/layout.tsx`)
16. Set up Firebase auth helpers
17. Create SignInModal component (Google + Email/Password + Apple)
18. Create AuthGuard component
19. Create UserMenu component (logged-in dropdown)
20. Test auth flow end-to-end

### PHASE 3: Values Screen (SEO priority #1)
21. Create `usePetData` hook (fetch from CDN)
22. Create PetImage component
23. Create PetValueCard component
24. Create FilterBar component
25. Create SearchBar component
26. Create PetGrid component
27. Build `/values` page with SSG + ISR
28. Build `/values/[slug]` page with `generateStaticParams`
29. Add JSON-LD structured data
30. Add meta tags and OpenGraph
31. Add internal linking (similar pets)
32. Test all pet pages render correctly

### PHASE 4: Calculator Screen
33. Create CalculatorBoard component
34. Create PetSelector modal
35. Create PetCard component (for calculator)
36. Create ValueBar component
37. Create TradeResult component
38. Build `/calculator` page (also serve as `/`)
39. Wire up useTradeStore for state
40. Add share trade functionality
41. Add SEO shell content around calculator

### PHASE 5: Trade Section
42. Create Firestore query helpers for `trades_new`
43. Create TradeCard component
44. Create TradeList component with real-time updates
45. Build `/trades` page with filters
46. Create CreateTradeForm component
47. Build `/trades/create` page (auth required)
48. Create TradeDetail component
49. Build `/trades/[id]` page
50. Add ReportTradeModal
51. Add ShareTradeButton

### PHASE 6: Feed / Design Section
52. Create PostCard component
53. Create PostFeed component with infinite scroll
54. Build `/feed` page
55. Create CreatePostModal with image upload
56. Create CommentsSection component
57. Build `/feed/[id]` page
58. Add ReportPostModal

### PHASE 7: Chat System
59. Create Firebase RTDB chat helpers
60. Create ChatRoomList component
61. Create MessageBubble component
62. Create MessageList component
63. Create MessageInput component
64. Build `/chat` page (room list + community chat)
65. Build `/chat/[roomId]` group chat page
66. Create OnlineUsers component
67. Create PrivateChat component
68. Build `/chat/dm/[userId]` DM page
69. Create CreateGroupModal
70. Implement online presence (visibilitychange API)
71. Add content moderation (profanity filter)

### PHASE 8: Profile Section
72. Create ProfileHeader component
73. Create ProfileTrades component
74. Create ProfilePosts component
75. Build `/profile` page (auth required, own profile)
76. Create EditProfileModal
77. Build `/profile/[userId]` public profile page
78. Create BlockedUsersList
79. Build `/settings` page

### PHASE 9: Analytics & News
80. Create chart components (TrendChart, TopPetsTable, etc.)
81. Build `/analytics` page with SSG + ISR
82. Build `/news` page

### PHASE 10: SEO & Polish
83. Create dynamic sitemap.ts
84. Create robots.txt
85. Add AdSense integration (AdBanner component)
86. Add meta tags to ALL pages
87. Test responsive design on all breakpoints
88. Performance audit (Lighthouse)
89. Test all pages with Google's Rich Results Test
90. Deploy to Vercel

---

## IMPORTANT NOTES FOR AI EXECUTION

1. **NEVER use React Native imports** — No `View`, `Text`, `TouchableOpacity`, `StyleSheet`, `FlatList`, `Modal`, `Image` from react-native. Use HTML elements + Tailwind CSS.

2. **Firebase Web SDK** — Always use `firebase/auth`, `firebase/firestore`, `firebase/database` — NOT `@react-native-firebase/*`.

3. **All pages must be responsive** — Test at 375px (mobile), 768px (tablet), 1280px (desktop).

4. **All pages need SEO** — Every page must have unique `<title>`, `<meta description>`, `<link rel="canonical">`.

5. **Use `next/image`** for all images with proper `width`, `height`, `alt` text.

6. **Use `next/link`** for all internal links (never `<a>` for internal navigation).

7. **Dark mode** — Every component must look good in both light and dark mode. Use `dark:` Tailwind prefix.

8. **Translation** — All user-facing text must use `useTranslations()` from `next-intl`, not hardcoded strings.

9. **Error handling** — All Firebase operations must have try/catch. Show user-friendly error toasts via Sonner.

10. **Loading states** — Every data-fetching component must show a skeleton/spinner while loading.

11. **Existing RN source reference path**: `/Volumes/Sohail/AI_Projects/adoptme-jan7/Code/`

12. **Pet data CDN returns a JSON object** where keys are categories and values are arrays of pet objects. Parse accordingly.

13. **Trade status codes**: `'w'` = win, `'l'` = lose, `'f'` = fair.

14. **Value change keys**: Format is `{variant}_{potion}` where variant = d/n/m and potion = nopotion/fly/ride/flyride.

15. **Keep the same Firebase project** (adoptme-7b50c) — web and mobile share the same backend.

16. **Admin check**: Compare user email against `config.adminEmails` array.
