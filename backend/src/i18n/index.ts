export type Locale = 'en' | 'ko';

let currentLocale: Locale = 'en';

/** Initialize i18n with locale from the system language. */
export function initI18n(): void {
  const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  const language = systemLocale.split('-')[0];

  if (isValidLocale(language)) {
    currentLocale = language as Locale;
  }

  console.log(`🌐 Locale: ${currentLocale}`);
}

function isValidLocale(locale: string): boolean {
  return ['en', 'ko'].includes(locale);
}
