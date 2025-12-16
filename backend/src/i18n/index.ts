import en from './locales/en.json';
import ko from './locales/ko.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';

export type Locale = 'en' | 'ko' | 'ja' | 'zh-CN' | 'zh-TW';

const translations: Record<Locale, Record<string, any>> = {
  en,
  ko,
  ja,
  'zh-CN': zhCN,
  'zh-TW': zhTW
};

let currentLocale: Locale = 'en';

/**
 * Initialize i18n with locale from environment or system
 */
export function initI18n(): void {
  const envLocale = process.env.LOCALE?.toLowerCase();

  if (envLocale && isValidLocale(envLocale)) {
    currentLocale = envLocale as Locale;
  } else {
    // Try to detect from system
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const language = systemLocale.split('-')[0];

    if (isValidLocale(language)) {
      currentLocale = language as Locale;
    }
  }

  console.log(`🌐 Locale: ${currentLocale}`);
}

/**
 * Check if locale is supported
 */
function isValidLocale(locale: string): boolean {
  return ['en', 'ko', 'ja', 'zh-CN', 'zh-TW'].includes(locale);
}

/**
 * Get translated string by key path
 * Example: t('server.started') or t('errors.port_in_use', { port: 1666 })
 */
export function t(keyPath: string, params?: Record<string, any>): string {
  const keys = keyPath.split('.');
  let value: any = translations[currentLocale];

  // Navigate through nested keys
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      // Fallback to English if key not found
      value = translations.en;
      for (const fallbackKey of keys) {
        if (value && typeof value === 'object' && fallbackKey in value) {
          value = value[fallbackKey];
        } else {
          return keyPath; // Return key path if translation not found
        }
      }
      break;
    }
  }

  // If value is not a string, return the key path
  if (typeof value !== 'string') {
    return keyPath;
  }

  // Replace parameters
  if (params) {
    return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
      return params[paramKey] !== undefined ? String(params[paramKey]) : match;
    });
  }

  return value;
}

/**
 * Get current locale
 */
export function getCurrentLocale(): Locale {
  return currentLocale;
}

/**
 * Set locale
 */
export function setLocale(locale: Locale): void {
  if (isValidLocale(locale)) {
    currentLocale = locale;
  }
}

/**
 * Get all available locales
 */
export function getAvailableLocales(): Locale[] {
  return ['en', 'ko', 'ja', 'zh-CN', 'zh-TW'];
}
