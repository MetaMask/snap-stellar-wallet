import en from '../../locales/en.json';
import es from '../../locales/es.json';

export const locales = {
  en: en.messages,
  es: es.messages,
};

export const FALLBACK_LANGUAGE: Locale = 'en';

export type Locale = keyof typeof locales;
/** When locale `messages` is an empty object, `keyof` is `never`; fall back to `string` for keys. */
type MessageKeys = keyof (typeof locales)[typeof FALLBACK_LANGUAGE];
export type LocalizedMessage = [MessageKeys] extends [never]
  ? string
  : MessageKeys;

/**
 * Fetches the translations based on the user's locale preference.
 * Falls back to the default language if the preferred locale is not available.
 *
 * @param locale - The user's preferred locale.
 * @returns A function that gets the translation for a given key.
 */
export function i18n(locale: string) {
  // Needs to be casted as EN is the main language and we can have the case where
  // messages are not yet completed for the other languages (e.g. empty `es` map).
  const messages = (locales[locale as Locale] ??
    locales[FALLBACK_LANGUAGE]) as Partial<
    Record<LocalizedMessage, { message: string }>
  >;

  return (id: LocalizedMessage, replaces?: Record<string, string>): string => {
    let message = messages[id]?.message ?? id;

    if (replaces && message) {
      Object.keys(replaces).forEach((key) => {
        const regex = new RegExp(`\\{${key}\\}`, 'gu');
        message = message.replace(regex, replaces[key] ?? '');
      });
    }

    return message;
  };
}
