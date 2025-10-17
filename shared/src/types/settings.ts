/**
 * Supported languages for internationalization
 */
export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW';

/**
 * Language metadata for UI display
 */
export interface LanguageInfo {
  code: SupportedLanguage;
  name: string;        // Native name (e.g., "한국어", "English")
  englishName: string; // English name for reference
}

/**
 * General application settings
 */
export interface GeneralSettings {
  language: SupportedLanguage;
}

/**
 * Available languages with metadata
 */
export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: 'ko', name: '한국어', englishName: 'Korean' },
  { code: 'en', name: 'English', englishName: 'English' },
  { code: 'ja', name: '日本語', englishName: 'Japanese' },
  { code: 'zh-CN', name: '简体中文', englishName: 'Chinese (Simplified)' },
  { code: 'zh-TW', name: '繁體中文', englishName: 'Chinese (Traditional)' },
];
