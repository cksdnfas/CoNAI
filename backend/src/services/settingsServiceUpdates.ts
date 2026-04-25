import type {
  AppSettings,
  AppearanceSettings,
  GenerationThrottleSettings,
  GeneralSettings,
  KaloscopeSettings,
  LlmSettings,
  MetadataExtractionSettings,
  SimilaritySettings,
  TaggerSettings,
  ThumbnailSettings,
  VideoOptimizationSettings,
} from '../types/settings';

/** Build the next settings state after applying a general-settings patch. */
export function applyGeneralSettingsUpdate(currentSettings: AppSettings, generalSettings: Partial<GeneralSettings>): AppSettings {
  return {
    ...currentSettings,
    general: {
      ...currentSettings.general,
      ...generalSettings,
      deleteProtection: {
        ...currentSettings.general.deleteProtection,
        ...generalSettings.deleteProtection,
      },
    },
  };
}

/** Build the next settings state after applying a tagger-settings patch. */
export function applyTaggerSettingsUpdate(currentSettings: AppSettings, taggerSettings: Partial<TaggerSettings>): AppSettings {
  return {
    ...currentSettings,
    tagger: {
      ...currentSettings.tagger,
      ...taggerSettings,
    },
  };
}

/** Build the next settings state after applying a kaloscope-settings patch. */
export function applyKaloscopeSettingsUpdate(currentSettings: AppSettings, kaloscopeSettings: Partial<KaloscopeSettings>): AppSettings {
  return {
    ...currentSettings,
    kaloscope: {
      ...currentSettings.kaloscope,
      ...kaloscopeSettings,
    },
  };
}

/** Build the next settings state after applying a similarity-settings patch with nested prompt settings merged safely. */
export function applySimilaritySettingsUpdate(currentSettings: AppSettings, similaritySettings: Partial<SimilaritySettings>): AppSettings {
  return {
    ...currentSettings,
    similarity: {
      ...currentSettings.similarity,
      ...similaritySettings,
      detailSimilarWeights: {
        ...currentSettings.similarity.detailSimilarWeights,
        ...similaritySettings.detailSimilarWeights,
      },
      detailSimilarThresholds: {
        ...currentSettings.similarity.detailSimilarThresholds,
        ...similaritySettings.detailSimilarThresholds,
      },
      promptSimilarity: {
        ...currentSettings.similarity.promptSimilarity,
        ...similaritySettings.promptSimilarity,
        weights: {
          ...currentSettings.similarity.promptSimilarity.weights,
          ...similaritySettings.promptSimilarity?.weights,
        },
        fieldThresholds: {
          ...currentSettings.similarity.promptSimilarity.fieldThresholds,
          ...similaritySettings.promptSimilarity?.fieldThresholds,
        },
      },
    },
  };
}

/** Build the next settings state after applying an appearance-settings patch. */
export function applyAppearanceSettingsUpdate(currentSettings: AppSettings, appearanceSettings: Partial<AppearanceSettings>): AppSettings {
  const {
    searchBoxWidth: _searchBoxWidth,
    searchDrawerWidth: _searchDrawerWidth,
    ...currentAppearanceWithoutLegacySearchWidths
  } = currentSettings.appearance as AppearanceSettings & { searchBoxWidth?: number; searchDrawerWidth?: number };
  const nextAppearance = {
    ...currentAppearanceWithoutLegacySearchWidths,
    ...appearanceSettings,
  };
  const desktopPageColumnsMinWidth = nextAppearance.desktopPageColumnsMinWidth;

  return {
    ...currentSettings,
    appearance: {
      ...nextAppearance,
      desktopSearchMinWidth: desktopPageColumnsMinWidth,
      desktopNavMinWidth: desktopPageColumnsMinWidth,
    },
  };
}

/** Build the next settings state after applying a metadata-extraction patch. */
export function applyMetadataSettingsUpdate(currentSettings: AppSettings, metadataSettings: Partial<MetadataExtractionSettings>): AppSettings {
  return {
    ...currentSettings,
    metadataExtraction: {
      ...currentSettings.metadataExtraction,
      ...metadataSettings,
    },
  };
}

/** Build the next settings state after applying a thumbnail-settings patch. */
export function applyThumbnailSettingsUpdate(currentSettings: AppSettings, thumbnailSettings: Partial<ThumbnailSettings>): AppSettings {
  return {
    ...currentSettings,
    thumbnail: {
      ...currentSettings.thumbnail,
      ...thumbnailSettings,
    },
  };
}

/** Build the next settings state after applying an image-save-settings patch. */
export function applyImageSaveSettingsUpdate(currentSettings: AppSettings, imageSaveSettings: Partial<AppSettings['imageSave']>): AppSettings {
  return {
    ...currentSettings,
    imageSave: {
      ...currentSettings.imageSave,
      ...imageSaveSettings,
    },
  };
}

/** Build the next settings state after applying a generation-throttle patch. */
export function applyGenerationThrottleSettingsUpdate(currentSettings: AppSettings, generationThrottleSettings: Partial<GenerationThrottleSettings>): AppSettings {
  return {
    ...currentSettings,
    generationThrottle: {
      novelai: {
        ...currentSettings.generationThrottle.novelai,
        ...generationThrottleSettings.novelai,
      },
      codex: {
        ...currentSettings.generationThrottle.codex,
        ...generationThrottleSettings.codex,
      },
    },
  };
}

/** Build the next settings state after applying a video-optimization-settings patch. */
export function applyVideoOptimizationSettingsUpdate(currentSettings: AppSettings, videoOptimizationSettings: Partial<VideoOptimizationSettings>): AppSettings {
  return {
    ...currentSettings,
    videoOptimization: {
      ...currentSettings.videoOptimization,
      ...videoOptimizationSettings,
    },
  };
}

/** Build the next settings state after applying an llm-settings patch. */
export function applyLlmSettingsUpdate(currentSettings: AppSettings, llmSettings: Partial<LlmSettings>): AppSettings {
  return {
    ...currentSettings,
    llm: {
      ...currentSettings.llm,
      ...llmSettings,
      systemPromptPresets: Array.isArray(llmSettings.systemPromptPresets)
        ? llmSettings.systemPromptPresets
        : currentSettings.llm.systemPromptPresets,
      promptPresets: Array.isArray(llmSettings.promptPresets)
        ? llmSettings.promptPresets
        : currentSettings.llm.promptPresets,
      structuredOutputJsonPresets: Array.isArray(llmSettings.structuredOutputJsonPresets)
        ? llmSettings.structuredOutputJsonPresets
        : currentSettings.llm.structuredOutputJsonPresets,
    },
  };
}
