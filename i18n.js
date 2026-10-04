import {trackGrowthEvent} from './Code/Helper/growthAnalytics';
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import dayjs from "dayjs";
import "dayjs/locale/ru";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/de";
import "dayjs/locale/ar";
import "dayjs/locale/ko";


// Only English (the fallback) is evaluated eagerly. The user's own language
// is required synchronously below, so it is on screen from the first frame
// without the other bundles being built.
import en from "./Code/Translation/en.json";

// Initialize MMKV storage
let storage;
try {
  const { createMMKV } = require("react-native-mmkv");
  storage = createMMKV();
} catch (e) {
  console.warn("[i18n] MMKV not available:", e.message);
  storage = {
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  };
}

// Map country codes to languages
const countryToLanguage = {
  BR: "pt",
  PH: "fil",
  VN: "vi",
  ID: "id",
  US: "en",
  MX: "es",
  FR: "fr",
  DE: "de",
  RU: "ru",
  IN: "en",
  AR: "ar",
  KR: "ko",
};

// Languages supported by the app, independent of subscription status.
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'ar', 'ru', 'ko'];

// ✅ Available languages with display names (for language selector UI)
export const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
];

// Function to get saved language from MMKV
const getStoredLanguage = () => {
  return storage.getString("appLanguage") || null;
};

// Function to get the device language
export const getDeviceLanguage = () => {
  const locales = RNLocalize.getLocales();
  return locales.length > 0 ? locales[0].languageCode : 'en';
};

// Determine initial language
const savedLanguage = getStoredLanguage();
const deviceLanguage = getDeviceLanguage();
const initialLanguage = SUPPORTED_LANGUAGES.includes(savedLanguage) ? savedLanguage
  : SUPPORTED_LANGUAGES.includes(deviceLanguage) ? deviceLanguage : 'en';

// Each bundle is a JSON module in the app bundle; require() evaluates only
// the one asked for (en is imported above).
const requireLanguage = (langCode) => {
  switch (langCode) {
    case 'ru': return require('./Code/Translation/ru.json');
    case 'es': return require('./Code/Translation/es.json');
    case 'fr': return require('./Code/Translation/fr.json');
    case 'de': return require('./Code/Translation/de.json');
    case 'ar': return require('./Code/Translation/ar.json');
    case 'ko': return require('./Code/Translation/ko.json');
    default: return null;
  }
};

const resources = { en: { translation: en } };
if (initialLanguage !== 'en') {
  const bundle = requireLanguage(initialLanguage);
  if (bundle) resources[initialLanguage] = { translation: bundle };
}

// Initialize i18next with English plus the user's language
i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: "v3",
    resources,
    lng: initialLanguage,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

// dayjs dates and "5 minutes ago" follow the app language, not English.
const syncDayjsLocale = (lng) => dayjs.locale(SUPPORTED_LANGUAGES.includes(lng) ? lng : 'en');
syncDayjsLocale(initialLanguage);
i18n.on('languageChanged', syncDayjsLocale);

// ✅ Lazy-load translation bundle on demand
export const loadLanguage = async (langCode) => {
  // Skip if already loaded or unsupported
  if (i18n.hasResourceBundle(langCode, 'translation')) {
    return true;
  }

  if (!SUPPORTED_LANGUAGES.includes(langCode)) {
    console.warn(`[i18n] Unsupported language: ${langCode}`);
    return false;
  }

  try {
    const bundle = requireLanguage(langCode);
    if (!bundle) return false;
    i18n.addResourceBundle(langCode, 'translation', bundle);
    return true;
  } catch (error) {
    console.error(`[i18n] Failed to load language ${langCode}:`, error);
    return false;
  }
};

// ✅ Function to update language with lazy-loading
export const setAppLanguage = async (languageCode) => {
  // Load language bundle if not already loaded
  if (!await loadLanguage(languageCode)) return false;

  // Change language
  i18n.changeLanguage(languageCode);
  storage.set("appLanguage", languageCode);
  trackGrowthEvent("app_language_selected", {language: languageCode});
};

export default i18n;
