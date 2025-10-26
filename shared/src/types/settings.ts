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
 * Stealth PNG scan mode
 */
export type StealthScanMode = 'full' | 'fast' | 'skip';

/**
 * Metadata extraction settings
 */
export interface MetadataExtractionSettings {
  // Secondary Extraction (Stealth PNG) 활성화 여부
  enableSecondaryExtraction: boolean;

  // Stealth PNG 스캔 모드
  stealthScanMode: StealthScanMode;

  // 크기 제한 (MB)
  stealthMaxFileSizeMB: number;

  // 해상도 제한 (메가픽셀)
  stealthMaxResolutionMP: number;

  // AI 도구별 스킵
  skipStealthForComfyUI: boolean;
  skipStealthForWebUI: boolean;
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
