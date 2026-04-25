import { Platform } from "react-native";

const isNoman = true; // Toggle this to switch configurations

// noman app id = ca-app-pub-1340655056171083~2708635067
//waqas app id = ca-app-pub-3701208411582706~4267174419
// noman pkgName= com.adoptmevaluescalc
//waqas pkgName = com.bloxfruitstock
const rev_cat_id = Platform.OS === 'ios' ? 'appl_fJWiaIgCJxAeJnMeDtvGsHtEWfR' : 'goog_eYhrxPwwtRYXwhBwsnfCvxmxnRX'

const config = {
  appName: isNoman ? 'Blox Fruit Values Calc' : 'Blox Fruit Stock',
  andriodBanner: isNoman ? 'ca-app-pub-1340655056171083/3794486024' : 'ca-app-pub-3701208411582706/4133745803',
  andriodIntestial: isNoman ? 'ca-app-pub-1340655056171083/7602595440' : 'ca-app-pub-3701208411582706/2820664136',
  andriodRewarded: isNoman ? 'ca-app-pub-1340655056171083/7759261705' : 'ca-app-pub-3701208411582706/5175818984',
  andriodOpenApp: isNoman ? 'ca-app-pub-1340655056171083/4976432101' : 'ca-app-pub-3701208411582706/2295931822',
  andriodNative: isNoman ? 'ca-app-pub-1340655056171083/4915996008' : 'ca-app-pub-3701208411582706/5457520430',
  IOsIntestial: isNoman ? 'ca-app-pub-5740215782746766/5910517787' : '',
  // Game interstitial ad IDs (used for A/B testing in IntAd.js)
  gameInterstitialAndroid: 'ca-app-pub-1340655056171083/1763031352',
  gameInterstitialIOS: 'ca-app-pub-5740215782746766/5126152752',
  IOsBanner: isNoman ? 'ca-app-pub-5740215782746766/9032339297' : '',
  IOsRewarded: isNoman ? 'ca-app-pub-5740215782746766/6913442412' : '',
  IOsOpenApp: isNoman ? 'ca-app-pub-5740215782746766/6747304345' : '',
  IOsNative: isNoman ? 'ca-app-pub-5740215782746766/8838394066' : '',

  apiKey: isNoman ? rev_cat_id : rev_cat_id,

  supportEmail: isNoman ? 'support@thesolanalabs.com' : 'mindfusionio.help@gmail.com',
  andriodShareLink: isNoman ? 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc' : 'https://play.google.com/store/apps/details?id=com.bloxfruitstock',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6745400111' : '',
  IOsShareLink: isNoman ? 'https://apps.apple.com/us/app/app-name/id6745400111' : '',
  webSite: isNoman ? 'https://adoptmevalues.app/' : 'https://bloxfruitvalue.today',

  isNoman: isNoman ? true : false,

  otherapplink: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.bloxfruitevalues' : 'https://apps.apple.com/us/app/app-name/id6737775801',
  otherapplink2: Platform.OS == 'android' ? 'https://play.google.com/store/apps/details?id=com.mm2tradesvalues' : 'https://apps.apple.com/us/app/app-name/id6737775801',
  // Cloud Functions URL (update with your actual region)
  cloudFunctionsUrl: 'https://us-central1-adoptme-7b50c.cloudfunctions.net',

  // Supabase (phase 1 scope: public/global chat only)
  supabaseUrl: 'https://kvtbtzhtcaanhjblyick.supabase.co',
  // Paste the FULL publishable key from Supabase → Settings → API
  // Starts with sb_publishable_... — safe to ship in the client bundle.
  supabasePublishableKey: 'sb_publishable_jS-BfPZ_e1WnhDaJYhU8LQ_wd3ipadn',

  colors: isNoman
    ? {
      primary: '#ff6666', // Muted grayish blue
      secondary: '#3E8BFC', // Bright action blue
      hasBlockGreen: 'rgb(255, 102, 102)', // Vibrant success green
      wantBlockRed: '#66b266', // Vivid warning red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#0f172a',
      white: 'white',
      black: 'black'
    }
    : {
      primary: '#697565', // Deep navy blue
      secondary: '#457B9D', // Muted teal
      hasBlockGreen: '#B8860B', // Light mint green
      wantBlockRed: '#E63946', // Warm, soft red
      backgroundLight: '#f2f2f7',
      backgroundDark: '#0f172a',
      white: 'white',
      black: 'black'
    },

  // ── Unified Dark Mode Palette (Slate-based) ──
  darkColors: {
    bg: '#0f172a',           // Slate-900 — main screen background
    surface: '#1e293b',      // Slate-800 — cards, bubbles, inputs
    elevated: '#334155',     // Slate-700 — modals, drawers, hover
    border: '#475569',       // Slate-600 — borders, dividers
    textPrimary: '#f1f5f9',  // Slate-100 — main text
    textSecondary: '#94a3b8',// Slate-400 — muted text, timestamps
    textMuted: '#64748b',    // Slate-500 — placeholder, disabled
  },
};

export default config;
