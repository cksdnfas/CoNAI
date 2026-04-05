import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import {
  AppSettings,
  AppearancePresetSlot,
  AppearanceThemeSettings,
  TaggerModel,
  TaggerDevice,
} from '../types/settings';

export const SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'settings.json');

const APPEARANCE_PRESET_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const;

/** Build the default appearance theme used for fresh settings files and fallback merges. */
export function getDefaultAppearanceTheme(): AppearanceThemeSettings {
  return {
    themeMode: 'system',
    accentPreset: 'conai',
    customPrimaryColor: '#f95e14',
    customSecondaryColor: '#ffb59a',
    surfacePreset: 'studio',
    customSurfaceBackgroundColor: '#131313',
    customSurfaceContainerColor: '#201f1f',
    customSurfaceHighColor: '#2a2a2a',
    radiusPreset: 'balanced',
    glassPreset: 'balanced',
    shadowPreset: 'balanced',
    density: 'comfortable',
    fontPreset: 'manrope',
    customFontFamily: 'Pretendard Variable, Pretendard, Manrope, ui-sans-serif, system-ui, sans-serif',
    customMonoFontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    customFontUrl: '',
    customMonoFontUrl: '',
    customFontFileName: '',
    customMonoFontFileName: '',
    fontScalePercent: 100,
    textScalePercent: 100,
    bodyFontWeightPreset: 'regular',
    emphasisFontWeightPreset: 'standard',
    searchBoxWidth: 380,
    searchDrawerWidth: 420,
    desktopSearchMinWidth: 768,
    desktopNavMinWidth: 1024,
    desktopPageColumnsMinWidth: 1280,
    detailRelatedImageMobileColumns: 1,
    detailRelatedImageColumns: 3,
    detailRelatedImageAspectRatio: 'square',
    groupExplorerCardStyle: 'compact-row',
    selectionOutlineWidth: 3,
    positiveBadgeColor: '#34d399',
    negativeBadgeColor: '#fb7185',
    autoBadgeColor: '#38bdf8',
    ratingBadgeColor: '#a78bfa',
  };
}

/** Build the default appearance preset slot list. */
export function getDefaultAppearancePresetSlots(): AppearancePresetSlot[] {
  return APPEARANCE_PRESET_SLOT_IDS.map((id, index) => ({
    id,
    label: `Slot ${index + 1}`,
    appearance: null,
    updatedAt: null,
  }));
}

/** Normalize raw appearance preset slots from persisted settings into the canonical shape. */
export function normalizeAppearancePresetSlots(rawSlots: unknown): AppearancePresetSlot[] {
  const defaults = getDefaultAppearancePresetSlots();

  if (!Array.isArray(rawSlots)) {
    return defaults;
  }

  return defaults.map((fallbackSlot, index) => {
    const rawSlot = rawSlots[index];
    if (!rawSlot || typeof rawSlot !== 'object') {
      return fallbackSlot;
    }

    const slotRecord = rawSlot as Record<string, unknown>;
    const appearanceSource = slotRecord.appearance;
    const defaultAppearance = getDefaultAppearanceTheme();
    const normalizedAppearance =
      appearanceSource && typeof appearanceSource === 'object'
        ? {
            ...defaultAppearance,
            ...appearanceSource,
          }
        : appearanceSource === null
          ? null
          : fallbackSlot.appearance;

    return {
      id: fallbackSlot.id,
      label: typeof slotRecord.label === 'string' && slotRecord.label.trim().length > 0
        ? slotRecord.label.trim().slice(0, 32)
        : fallbackSlot.label,
      appearance: normalizedAppearance,
      updatedAt: typeof slotRecord.updatedAt === 'string' || slotRecord.updatedAt === null
        ? slotRecord.updatedAt
        : fallbackSlot.updatedAt,
    };
  });
}

/** Build the full default settings object, including environment-driven defaults. */
export function getDefaultSettingsFromEnvironment(): AppSettings {
  return {
    general: {
      language: 'ko',
      deleteProtection: {
        enabled: true,
        recycleBinPath: 'RecycleBin'
      },
      enableGallery: true,
      autoCleanupCanvasOnShutdown: false,
      showRatingBadges: true
    },
    tagger: {
      enabled: process.env.TAGGER_ENABLED === 'true',
      autoTagOnUpload: false,
      model: (process.env.TAGGER_MODEL as TaggerModel) || 'vit',
      device: (process.env.TAGGER_DEVICE as TaggerDevice) || 'auto',
      generalThreshold: parseFloat(process.env.TAGGER_GEN_THRESHOLD || '0.35'),
      characterThreshold: parseFloat(process.env.TAGGER_CHAR_THRESHOLD || '0.75'),
      pythonPath: process.env.PYTHON_PATH || 'python',
      keepModelLoaded: true,
      autoUnloadMinutes: 5,
    },
    kaloscope: {
      enabled: process.env.KALOSCOPE_ENABLED === 'true',
      autoTagOnUpload: false,
      device: ((process.env.KALOSCOPE_DEVICE as 'auto' | 'cpu' | 'cuda') || 'auto'),
      topK: Number.parseInt(process.env.KALOSCOPE_TOPK || '15', 10),
    },
    similarity: {
      autoGenerateHashOnUpload: true,
      detailSimilarThreshold: 15,
      detailSimilarLimit: 24,
      detailSimilarIncludeColorSimilarity: false,
      detailSimilarSortBy: 'similarity',
      detailSimilarSortOrder: 'DESC',
      promptSimilarity: {
        enabled: true,
        algorithm: 'simhash',
        autoBuildOnMetadataUpdate: true,
        resultLimit: 60,
        combinedThreshold: 50,
        weights: {
          positive: 1,
          negative: 0,
          auto: 0,
        },
        fieldThresholds: {
          positive: 50,
          negative: 50,
          auto: 50,
        },
      },
    },
    appearance: {
      ...getDefaultAppearanceTheme(),
      presetSlots: getDefaultAppearancePresetSlots(),
    },
    metadataExtraction: {
      enableSecondaryExtraction: true,
      stealthScanMode: 'fast',
      stealthMaxFileSizeMB: 10,
      stealthMaxResolutionMP: 5,
      skipStealthForComfyUI: true,
      skipStealthForWebUI: false,
    },
    thumbnail: {
      size: '1080',
      quality: 80,
    },
    imageSave: {
      defaultFormat: 'webp',
      quality: 85,
      resizeEnabled: true,
      maxWidth: 1536,
      maxHeight: 1536,
      alwaysShowDialog: true,
      applyToGenerationAttachments: true,
      applyToEditorSave: true,
      applyToCanvasSave: true,
      applyToUpload: true,
      applyToWorkflowOutputs: true,
    },
  };
}

/** Ensure the config directory exists before reading or writing the settings file. */
export function ensureSettingsConfigDirectory(): void {
  const configDir = path.dirname(SETTINGS_FILE_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/** Merge raw persisted settings into the canonical defaults with env overrides applied last. */
export function mergeLoadedSettingsWithDefaults(loadedSettings: any, defaults: AppSettings): AppSettings {
  return {
    general: {
      ...defaults.general,
      ...loadedSettings.general,
    },
    tagger: {
      ...defaults.tagger,
      ...loadedSettings.tagger,
      ...(process.env.PYTHON_PATH && { pythonPath: process.env.PYTHON_PATH }),
    },
    kaloscope: {
      ...defaults.kaloscope,
      ...loadedSettings.kaloscope,
      ...(process.env.KALOSCOPE_ENABLED !== undefined && { enabled: process.env.KALOSCOPE_ENABLED === 'true' }),
      ...(process.env.KALOSCOPE_DEVICE && { device: process.env.KALOSCOPE_DEVICE as 'auto' | 'cpu' | 'cuda' }),
      ...(process.env.KALOSCOPE_TOPK && { topK: Number.parseInt(process.env.KALOSCOPE_TOPK, 10) }),
    },
    similarity: {
      ...defaults.similarity,
      ...loadedSettings.similarity,
      promptSimilarity: {
        ...defaults.similarity.promptSimilarity,
        ...loadedSettings.similarity?.promptSimilarity,
        weights: {
          ...defaults.similarity.promptSimilarity.weights,
          ...loadedSettings.similarity?.promptSimilarity?.weights,
        },
        fieldThresholds: {
          ...defaults.similarity.promptSimilarity.fieldThresholds,
          ...loadedSettings.similarity?.promptSimilarity?.fieldThresholds,
        },
      },
    },
    appearance: {
      ...defaults.appearance,
      ...loadedSettings.appearance,
      presetSlots: normalizeAppearancePresetSlots(loadedSettings.appearance?.presetSlots),
    },
    metadataExtraction: {
      ...defaults.metadataExtraction,
      ...loadedSettings.metadataExtraction,
    },
    thumbnail: {
      ...defaults.thumbnail,
      ...loadedSettings.thumbnail,
    },
    imageSave: {
      ...defaults.imageSave,
      ...loadedSettings.imageSave,
    },
  };
}

/** Check whether persisted settings are missing any top-level section fields from current defaults. */
export function hasMissingSettingsFields(loaded: any, defaults: AppSettings): boolean {
  for (const key of Object.keys(defaults.general)) {
    if (!(key in (loaded.general || {}))) {
      console.log(`[SettingsService] Missing field: general.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.tagger)) {
    if (!(key in (loaded.tagger || {}))) {
      console.log(`[SettingsService] Missing field: tagger.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.similarity)) {
    if (!(key in (loaded.similarity || {}))) {
      console.log(`[SettingsService] Missing field: similarity.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.kaloscope)) {
    if (!(key in (loaded.kaloscope || {}))) {
      console.log(`[SettingsService] Missing field: kaloscope.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.appearance)) {
    if (!(key in (loaded.appearance || {}))) {
      console.log(`[SettingsService] Missing field: appearance.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.metadataExtraction)) {
    if (!(key in (loaded.metadataExtraction || {}))) {
      console.log(`[SettingsService] Missing field: metadataExtraction.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.thumbnail)) {
    if (!(key in (loaded.thumbnail || {}))) {
      console.log(`[SettingsService] Missing field: thumbnail.${key}`);
      return true;
    }
  }

  for (const key of Object.keys(defaults.imageSave)) {
    if (!(key in (loaded.imageSave || {}))) {
      console.log(`[SettingsService] Missing field: imageSave.${key}`);
      return true;
    }
  }

  return false;
}

/** Read and parse the raw settings JSON file when it exists. */
export function readRawSettingsFile(): any {
  const fileContent = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
  return JSON.parse(fileContent);
}

/** Persist the settings JSON to disk after ensuring the config directory exists. */
export function writeSettingsFile(settings: AppSettings): void {
  ensureSettingsConfigDirectory();
  fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}
