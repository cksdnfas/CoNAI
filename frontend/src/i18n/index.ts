import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
// Korean
import koCommon from './locales/ko/common.json';
import koSettings from './locales/ko/settings.json';
import koNavigation from './locales/ko/navigation.json';

import koImageDetail from './locales/ko/imageDetail.json';
import koUpload from './locales/ko/upload.json';
import koImageGroups from './locales/ko/imageGroups.json';
import koSearch from './locales/ko/search.json';
import koPromptManagement from './locales/ko/promptManagement.json';
import koWorkflows from './locales/ko/workflows.json';
import koImageGeneration from './locales/ko/imageGeneration.json';
import koGenerationHistory from './locales/ko/generationHistory.json';
import koServers from './locales/ko/servers.json';
import koErrors from './locales/ko/errors.json';
import koValidation from './locales/ko/validation.json';
import koWildcards from './locales/ko/wildcards.json';

// English
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enNavigation from './locales/en/navigation.json';

import enImageDetail from './locales/en/imageDetail.json';
import enUpload from './locales/en/upload.json';
import enImageGroups from './locales/en/imageGroups.json';
import enSearch from './locales/en/search.json';
import enPromptManagement from './locales/en/promptManagement.json';
import enWorkflows from './locales/en/workflows.json';
import enImageGeneration from './locales/en/imageGeneration.json';
import enGenerationHistory from './locales/en/generationHistory.json';
import enServers from './locales/en/servers.json';
import enErrors from './locales/en/errors.json';
import enValidation from './locales/en/validation.json';
import enWildcards from './locales/en/wildcards.json';

// Japanese
import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaNavigation from './locales/ja/navigation.json';

import jaImageDetail from './locales/ja/imageDetail.json';
import jaUpload from './locales/ja/upload.json';
import jaImageGroups from './locales/ja/imageGroups.json';
import jaSearch from './locales/ja/search.json';
import jaPromptManagement from './locales/ja/promptManagement.json';
import jaWorkflows from './locales/ja/workflows.json';
import jaImageGeneration from './locales/ja/imageGeneration.json';
import jaGenerationHistory from './locales/ja/generationHistory.json';
import jaServers from './locales/ja/servers.json';
import jaErrors from './locales/ja/errors.json';
import jaValidation from './locales/ja/validation.json';
import jaWildcards from './locales/ja/wildcards.json';
import jaAuth from './locales/ja/auth.json';

// Simplified Chinese
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNSettings from './locales/zh-CN/settings.json';
import zhCNNavigation from './locales/zh-CN/navigation.json';

import zhCNImageDetail from './locales/zh-CN/imageDetail.json';
import zhCNUpload from './locales/zh-CN/upload.json';
import zhCNImageGroups from './locales/zh-CN/imageGroups.json';
import zhCNSearch from './locales/zh-CN/search.json';
import zhCNPromptManagement from './locales/zh-CN/promptManagement.json';
import zhCNWorkflows from './locales/zh-CN/workflows.json';
import zhCNImageGeneration from './locales/zh-CN/imageGeneration.json';
import zhCNGenerationHistory from './locales/zh-CN/generationHistory.json';
import zhCNServers from './locales/zh-CN/servers.json';
import zhCNErrors from './locales/zh-CN/errors.json';
import zhCNValidation from './locales/zh-CN/validation.json';
import zhCNWildcards from './locales/zh-CN/wildcards.json';
import zhCNAuth from './locales/zh-CN/auth.json';

// Traditional Chinese
import zhTWCommon from './locales/zh-TW/common.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWNavigation from './locales/zh-TW/navigation.json';

import zhTWImageDetail from './locales/zh-TW/imageDetail.json';
import zhTWUpload from './locales/zh-TW/upload.json';
import zhTWImageGroups from './locales/zh-TW/imageGroups.json';
import zhTWSearch from './locales/zh-TW/search.json';
import zhTWPromptManagement from './locales/zh-TW/promptManagement.json';
import zhTWWorkflows from './locales/zh-TW/workflows.json';
import zhTWImageGeneration from './locales/zh-TW/imageGeneration.json';
import zhTWGenerationHistory from './locales/zh-TW/generationHistory.json';
import zhTWServers from './locales/zh-TW/servers.json';
import zhTWErrors from './locales/zh-TW/errors.json';
import zhTWValidation from './locales/zh-TW/validation.json';
import zhTWWildcards from './locales/zh-TW/wildcards.json';
import zhTWAuth from './locales/zh-TW/auth.json';

// Translation resources
const resources = {
  ko: {
    common: koCommon,
    settings: koSettings,
    navigation: koNavigation,

    imageDetail: koImageDetail,
    upload: koUpload,
    imageGroups: koImageGroups,
    search: koSearch,
    promptManagement: koPromptManagement,
    workflows: koWorkflows,
    imageGeneration: koImageGeneration,
    generationHistory: koGenerationHistory,
    servers: koServers,
    errors: koErrors,
    validation: koValidation,
    wildcards: koWildcards,
  },
  en: {
    common: enCommon,
    settings: enSettings,
    navigation: enNavigation,

    imageDetail: enImageDetail,
    upload: enUpload,
    imageGroups: enImageGroups,
    search: enSearch,
    promptManagement: enPromptManagement,
    workflows: enWorkflows,
    imageGeneration: enImageGeneration,
    generationHistory: enGenerationHistory,
    servers: enServers,
    errors: enErrors,
    validation: enValidation,
    wildcards: enWildcards,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    navigation: jaNavigation,

    imageDetail: jaImageDetail,
    upload: jaUpload,
    imageGroups: jaImageGroups,
    search: jaSearch,
    promptManagement: jaPromptManagement,
    workflows: jaWorkflows,
    imageGeneration: jaImageGeneration,
    generationHistory: jaGenerationHistory,
    servers: jaServers,
    errors: jaErrors,
    validation: jaValidation,
    wildcards: jaWildcards,
    auth: jaAuth,
  },
  'zh-CN': {
    common: zhCNCommon,
    settings: zhCNSettings,
    navigation: zhCNNavigation,

    imageDetail: zhCNImageDetail,
    upload: zhCNUpload,
    imageGroups: zhCNImageGroups,
    search: zhCNSearch,
    promptManagement: zhCNPromptManagement,
    workflows: zhCNWorkflows,
    imageGeneration: zhCNImageGeneration,
    generationHistory: zhCNGenerationHistory,
    servers: zhCNServers,
    errors: zhCNErrors,
    validation: zhCNValidation,
    wildcards: zhCNWildcards,
    auth: zhCNAuth,
  },
  'zh-TW': {
    common: zhTWCommon,
    settings: zhTWSettings,
    navigation: zhTWNavigation,

    imageDetail: zhTWImageDetail,
    upload: zhTWUpload,
    imageGroups: zhTWImageGroups,
    search: zhTWSearch,
    promptManagement: zhTWPromptManagement,
    workflows: zhTWWorkflows,
    imageGeneration: zhTWImageGeneration,
    generationHistory: zhTWGenerationHistory,
    servers: zhTWServers,
    errors: zhTWErrors,
    validation: zhTWValidation,
    wildcards: zhTWWildcards,
    auth: zhTWAuth,
  },
};

// Initialize i18next
i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    resources,
    fallbackLng: 'en', // Fallback language if user language not available
    defaultNS: 'common', // Default namespace
    ns: [
      'common',
      'settings',
      'navigation',

      'imageDetail',
      'upload',
      'imageGroups',
      'search',
      'promptManagement',
      'workflows',
      'imageGeneration',
      'generationHistory',
      'servers',
      'errors',
      'validation',
      'wildcards',
    ], // Available namespaces

    detection: {
      // Order of language detection methods
      order: ['localStorage', 'navigator'],
      // Cache user language preference
      caches: ['localStorage'],
      lookupLocalStorage: 'i18nextLng',
    },

    interpolation: {
      escapeValue: false, // React already escapes values
    },

    react: {
      useSuspense: false, // Disable suspense for now
    },
  });

export default i18n;
