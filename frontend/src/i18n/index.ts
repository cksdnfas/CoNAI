import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
// Korean
import koCommon from './locales/ko/common.json';
import koSettings from './locales/ko/settings.json';
import koNavigation from './locales/ko/navigation.json';
import koGallery from './locales/ko/gallery.json';
import koImageDetail from './locales/ko/imageDetail.json';
import koUpload from './locales/ko/upload.json';
import koImageGroups from './locales/ko/imageGroups.json';
import koSearch from './locales/ko/search.json';
import koPromptManagement from './locales/ko/promptManagement.json';
import koWorkflows from './locales/ko/workflows.json';
import koImageGeneration from './locales/ko/imageGeneration.json';
import koServers from './locales/ko/servers.json';
import koErrors from './locales/ko/errors.json';
import koValidation from './locales/ko/validation.json';

// English
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enNavigation from './locales/en/navigation.json';
import enGallery from './locales/en/gallery.json';
import enImageDetail from './locales/en/imageDetail.json';
import enUpload from './locales/en/upload.json';
import enImageGroups from './locales/en/imageGroups.json';
import enSearch from './locales/en/search.json';
import enPromptManagement from './locales/en/promptManagement.json';
import enWorkflows from './locales/en/workflows.json';
import enImageGeneration from './locales/en/imageGeneration.json';
import enServers from './locales/en/servers.json';
import enErrors from './locales/en/errors.json';
import enValidation from './locales/en/validation.json';

// Japanese
import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaNavigation from './locales/ja/navigation.json';
import jaGallery from './locales/ja/gallery.json';
import jaImageDetail from './locales/ja/imageDetail.json';
import jaUpload from './locales/ja/upload.json';
import jaImageGroups from './locales/ja/imageGroups.json';
import jaSearch from './locales/ja/search.json';
import jaPromptManagement from './locales/ja/promptManagement.json';
import jaWorkflows from './locales/ja/workflows.json';
import jaImageGeneration from './locales/ja/imageGeneration.json';
import jaServers from './locales/ja/servers.json';
import jaErrors from './locales/ja/errors.json';
import jaValidation from './locales/ja/validation.json';

// Simplified Chinese
import zhCNCommon from './locales/zh-CN/common.json';
import zhCNSettings from './locales/zh-CN/settings.json';
import zhCNNavigation from './locales/zh-CN/navigation.json';
import zhCNGallery from './locales/zh-CN/gallery.json';
import zhCNImageDetail from './locales/zh-CN/imageDetail.json';
import zhCNUpload from './locales/zh-CN/upload.json';
import zhCNImageGroups from './locales/zh-CN/imageGroups.json';
import zhCNSearch from './locales/zh-CN/search.json';
import zhCNPromptManagement from './locales/zh-CN/promptManagement.json';
import zhCNWorkflows from './locales/zh-CN/workflows.json';
import zhCNImageGeneration from './locales/zh-CN/imageGeneration.json';
import zhCNServers from './locales/zh-CN/servers.json';
import zhCNErrors from './locales/zh-CN/errors.json';
import zhCNValidation from './locales/zh-CN/validation.json';

// Traditional Chinese
import zhTWCommon from './locales/zh-TW/common.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWNavigation from './locales/zh-TW/navigation.json';
import zhTWGallery from './locales/zh-TW/gallery.json';
import zhTWImageDetail from './locales/zh-TW/imageDetail.json';
import zhTWUpload from './locales/zh-TW/upload.json';
import zhTWImageGroups from './locales/zh-TW/imageGroups.json';
import zhTWSearch from './locales/zh-TW/search.json';
import zhTWPromptManagement from './locales/zh-TW/promptManagement.json';
import zhTWWorkflows from './locales/zh-TW/workflows.json';
import zhTWImageGeneration from './locales/zh-TW/imageGeneration.json';
import zhTWServers from './locales/zh-TW/servers.json';
import zhTWErrors from './locales/zh-TW/errors.json';
import zhTWValidation from './locales/zh-TW/validation.json';

// Translation resources
const resources = {
  ko: {
    common: koCommon,
    settings: koSettings,
    navigation: koNavigation,
    gallery: koGallery,
    imageDetail: koImageDetail,
    upload: koUpload,
    imageGroups: koImageGroups,
    search: koSearch,
    promptManagement: koPromptManagement,
    workflows: koWorkflows,
    imageGeneration: koImageGeneration,
    servers: koServers,
    errors: koErrors,
    validation: koValidation,
  },
  en: {
    common: enCommon,
    settings: enSettings,
    navigation: enNavigation,
    gallery: enGallery,
    imageDetail: enImageDetail,
    upload: enUpload,
    imageGroups: enImageGroups,
    search: enSearch,
    promptManagement: enPromptManagement,
    workflows: enWorkflows,
    imageGeneration: enImageGeneration,
    servers: enServers,
    errors: enErrors,
    validation: enValidation,
  },
  ja: {
    common: jaCommon,
    settings: jaSettings,
    navigation: jaNavigation,
    gallery: jaGallery,
    imageDetail: jaImageDetail,
    upload: jaUpload,
    imageGroups: jaImageGroups,
    search: jaSearch,
    promptManagement: jaPromptManagement,
    workflows: jaWorkflows,
    imageGeneration: jaImageGeneration,
    servers: jaServers,
    errors: jaErrors,
    validation: jaValidation,
  },
  'zh-CN': {
    common: zhCNCommon,
    settings: zhCNSettings,
    navigation: zhCNNavigation,
    gallery: zhCNGallery,
    imageDetail: zhCNImageDetail,
    upload: zhCNUpload,
    imageGroups: zhCNImageGroups,
    search: zhCNSearch,
    promptManagement: zhCNPromptManagement,
    workflows: zhCNWorkflows,
    imageGeneration: zhCNImageGeneration,
    servers: zhCNServers,
    errors: zhCNErrors,
    validation: zhCNValidation,
  },
  'zh-TW': {
    common: zhTWCommon,
    settings: zhTWSettings,
    navigation: zhTWNavigation,
    gallery: zhTWGallery,
    imageDetail: zhTWImageDetail,
    upload: zhTWUpload,
    imageGroups: zhTWImageGroups,
    search: zhTWSearch,
    promptManagement: zhTWPromptManagement,
    workflows: zhTWWorkflows,
    imageGeneration: zhTWImageGeneration,
    servers: zhTWServers,
    errors: zhTWErrors,
    validation: zhTWValidation,
  },
};

// Initialize i18next
i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    resources,
    fallbackLng: 'ko', // Fallback language if user language not available
    defaultNS: 'common', // Default namespace
    ns: [
      'common',
      'settings',
      'navigation',
      'gallery',
      'imageDetail',
      'upload',
      'imageGroups',
      'search',
      'promptManagement',
      'workflows',
      'imageGeneration',
      'servers',
      'errors',
      'validation',
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
