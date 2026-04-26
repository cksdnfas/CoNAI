export type Locale = 'en' | 'ko' | 'ja' | 'zh-CN' | 'zh-TW';

let currentLocale: Locale = 'en';

/** Initialize i18n with locale from environment or system. */
export function initI18n(): void {
  const envLocale = process.env.LOCALE?.toLowerCase();

  if (envLocale && isValidLocale(envLocale)) {
    currentLocale = envLocale as Locale;
  } else {
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const language = systemLocale.split('-')[0];

    if (isValidLocale(language)) {
      currentLocale = language as Locale;
    }
  }

  console.log(`🌐 Locale: ${currentLocale}`);
}

function isValidLocale(locale: string): boolean {
  return ['en', 'ko', 'ja', 'zh-CN', 'zh-TW'].includes(locale);
}
