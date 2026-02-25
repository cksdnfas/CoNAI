export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh-CN' | 'zh-TW';
export interface LanguageInfo {
    code: SupportedLanguage;
    name: string;
    englishName: string;
}
export type StealthScanMode = 'full' | 'fast' | 'skip';
export interface MetadataExtractionSettings {
    enableSecondaryExtraction: boolean;
    stealthScanMode: StealthScanMode;
    stealthMaxFileSizeMB: number;
    stealthMaxResolutionMP: number;
    skipStealthForComfyUI: boolean;
    skipStealthForWebUI: boolean;
}
export interface GeneralSettings {
    language: SupportedLanguage;
}
export declare const SUPPORTED_LANGUAGES: LanguageInfo[];
//# sourceMappingURL=settings.d.ts.map