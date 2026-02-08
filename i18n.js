import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as RNLocalize from "react-native-localize";
import { MMKV } from "react-native-mmkv";

// ✅ Only import English at startup (fallback language)
import en from "./Code/Translation/en.json";

// Initialize MMKV storage
const storage = new MMKV();

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
};

// Supported languages for validation (5 premium high-eCPM languages)
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'ar'];

// ✅ Available languages with display names (for language selector UI)
export const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
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
const initialLanguage = getStoredLanguage() || 'en';

// Initialize i18next with only English
i18n
  .use(initReactI18next)
  .init({
    compatibilityJSON: "v3",
    resources: {
      en: { translation: en },
    },
    lng: initialLanguage,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  });

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
    // Dynamic import of language file
    let resources;
    switch (langCode) {
      case 'es': resources = await import('./Code/Translation/es.json'); break;
      case 'fr': resources = await import('./Code/Translation/fr.json'); break;
      case 'de': resources = await import('./Code/Translation/de.json'); break;
      case 'ar': resources = await import('./Code/Translation/ar.json'); break;
      default: return false;
    }

    i18n.addResourceBundle(langCode, 'translation', resources.default);
    return true;
  } catch (error) {
    console.error(`[i18n] Failed to load language ${langCode}:`, error);
    return false;
  }
};

// ✅ Function to update language with lazy-loading
export const setAppLanguage = async (languageCode) => {
  // Load language bundle if not already loaded
  await loadLanguage(languageCode);

  // Change language
  i18n.changeLanguage(languageCode);
  storage.set("appLanguage", languageCode);
};

// ✅ Load initial language if not English
if (initialLanguage !== 'en') {
  loadLanguage(initialLanguage);
}

export default i18n;
