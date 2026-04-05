import type {
  AppSettings,
  AppearanceSettings,
  GeneralSettings,
  KaloscopeSettings,
  MetadataExtractionSettings,
  SimilaritySettings,
  TaggerSettings,
  ThumbnailSettings,
} from '../types/settings';

/** Build the next settings state after applying a general-settings patch. */
export function applyGeneralSettingsUpdate(currentSettings: AppSettings, generalSettings: Partial<GeneralSettings>): AppSettings {
  return {
    ...currentSettings,
    general: {
      ...currentSettings.general,
      ...generalSettings,
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
  return {
    ...currentSettings,
    appearance: {
      ...currentSettings.appearance,
      ...appearanceSettings,
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
