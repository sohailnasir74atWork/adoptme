/**
 * useMessageTranslation — shared "translate this message" behaviour.
 *
 * Extracted from ChatScreen/GroupChat/MessagesList.jsx (2026-09-02) so group
 * chat can offer translation too. Group chat rendered through
 * GroupMessageList, which already accepted an `onTranslate` prop — but
 * GroupChatScreen never passed one, so the option simply never appeared in the
 * long-press menu. The logic itself lived inline in MessagesList and was
 * unavailable to any other screen.
 *
 * Behaviour is unchanged from the original implementation:
 *   - Fruit/pet names are masked with placeholders before the request and
 *     restored afterwards, so Google doesn't translate item names.
 *   - Pro users and the `free_translation` RTDB flag get unlimited use;
 *     everyone else is metered by useLocalState's daily counter.
 *   - The counter is only incremented on a SUCCESSFUL translation.
 *   - The result is shown in an Alert with the remaining-tries footer.
 *
 * The daily counter lives in useLocalState, so every screen using this hook
 * shares one budget — translating in group chat draws from the same allowance
 * as the community chat.
 */

import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { FRUIT_KEYWORDS } from './filter';
import { getDeviceLanguage } from '../../i18n';
import { mixpanel } from '../AppHelper/MixPenel';

export const useMessageTranslation = () => {
  const { t } = useTranslation();
  const { api, freeTranslation } = useGlobalState();
  const {
    canTranslate,
    incrementTranslationCount,
    getRemainingTranslationTries,
    localState,
  } = useLocalState();

  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  // Pre-compile once — FRUIT_KEYWORDS is long and this runs per translation.
  const fruitRegexPatterns = useMemo(
    () =>
      FRUIT_KEYWORDS.map((word, index) => ({
        regex: new RegExp(`\\b${word}\\b`, 'gi'),
        placeholder: `__FRUIT_${index}__`,
        word,
      })),
    [],
  );

  const translateText = useCallback(
    async (text, targetLang = deviceLanguage) => {
      if (!text || typeof text !== 'string') return null;

      const placeholders = {};
      let maskedText = text;

      // Mask item names so they survive the round trip untranslated.
      fruitRegexPatterns.forEach(({ regex, placeholder, word }) => {
        maskedText = maskedText.replace(regex, placeholder);
        placeholders[placeholder] = word;
      });

      try {
        const response = await axios.post(
          'https://translation.googleapis.com/language/translate/v2',
          {},
          {
            params: {
              q: maskedText,
              target: targetLang,
              key: api,
            },
          },
        );

        let translated = response.data.data.translations[0].translatedText;

        Object.entries(placeholders).forEach(([placeholder, word]) => {
          translated = translated.replace(new RegExp(placeholder, 'g'), word);
        });

        mixpanel.track('Translation', { lang: targetLang });

        return translated;
      } catch (err) {
        console.error('Translation Error:', err);
        return null;
      }
    },
    [fruitRegexPatterns, deviceLanguage, api],
  );

  /**
   * Long-press handler. Takes a message object; needs only `.text`.
   * Safe to pass straight to MessagesList / GroupMessageList's `onTranslate`.
   */
  const handleTranslate = useCallback(
    async (item) => {
      if (!item || !item.text) {
        Alert.alert(t('chat.error'), t('chat.invalid_translation'));
        return;
      }

      const isUnlimited = freeTranslation || localState?.isPro;

      if (!isUnlimited && !canTranslate()) {
        Alert.alert(
          t('chat.translation_limit_title'),
          t('chat.translation_limit_message'),
        );
        return;
      }

      const translated = await translateText(item.text, deviceLanguage);

      if (translated) {
        if (!isUnlimited) incrementTranslationCount();

        const remaining = isUnlimited
          ? t('chat.unlimited')
          : `${getRemainingTranslationTries()} remaining`;

        Alert.alert(
          t('chat.translated_message_title'),
          `${translated}\n\n${t('chat.daily_limit_label', { remaining })}${
            isUnlimited ? '' : t('chat.upgrade_pro_translation')
          }`,
        );
      } else {
        Alert.alert(t('chat.error'), t('chat.translation_failed'));
      }
    },
    [
      t,
      canTranslate,
      freeTranslation,
      localState?.isPro,
      incrementTranslationCount,
      getRemainingTranslationTries,
      translateText,
      deviceLanguage,
    ],
  );

  return { handleTranslate, translateText, deviceLanguage };
};

export default useMessageTranslation;
