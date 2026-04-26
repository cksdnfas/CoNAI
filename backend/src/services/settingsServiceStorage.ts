import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import {
  AppSettings,
  AppearancePresetSlot,
  AppearanceThemeSettings,
  DEFAULT_ARTIST_LINK_URL_TEMPLATE,
  LlmPresetRecord,
  TaggerModel,
  TaggerDevice,
  WallpaperLayoutPreset,
  WallpaperWidgetInstance,
  WallpaperWidgetType,
} from '../types/settings';

export const SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'settings.json');

const APPEARANCE_PRESET_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const;
const WALLPAPER_WIDGET_TYPES: WallpaperWidgetType[] = ['clock', 'queue-status', 'recent-results', 'activity-pulse', 'group-image-view', 'image-showcase', 'floating-collage', 'text-note'];

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
    desktopSearchMinWidth: 1280,
    desktopNavMinWidth: 1280,
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

/** Normalize one raw wallpaper widget into the persisted settings shape. */
function normalizeWallpaperWidget(rawWidget: unknown): WallpaperWidgetInstance | null {
  if (!rawWidget || typeof rawWidget !== 'object') {
    return null;
  }

  const record = rawWidget as Record<string, unknown>;
  if (typeof record.id !== 'string' || !WALLPAPER_WIDGET_TYPES.includes(record.type as WallpaperWidgetType)) {
    return null;
  }

  const numberFields = ['x', 'y', 'w', 'h', 'zIndex'] as const;
  for (const field of numberFields) {
    if (!Number.isFinite(record[field])) {
      return null;
    }
  }

  if (typeof record.locked !== 'boolean' || typeof record.hidden !== 'boolean') {
    return null;
  }

  return {
    id: record.id,
    type: record.type as WallpaperWidgetType,
    x: Number(record.x),
    y: Number(record.y),
    w: Number(record.w),
    h: Number(record.h),
    zIndex: Number(record.zIndex),
    locked: record.locked,
    hidden: record.hidden,
    settings: record.settings && typeof record.settings === 'object' ? record.settings as Record<string, unknown> : {},
  };
}

/** Normalize raw wallpaper layout presets from persisted settings into the canonical shape. */
export function normalizeWallpaperLayoutPresets(rawPresets: unknown): WallpaperLayoutPreset[] {
  if (!Array.isArray(rawPresets)) {
    return [];
  }

  return rawPresets.flatMap((rawPreset) => {
    if (!rawPreset || typeof rawPreset !== 'object') {
      return [];
    }

    const record = rawPreset as Record<string, unknown>;
    if (
      typeof record.id !== 'string' ||
      typeof record.name !== 'string' ||
      typeof record.canvasPresetId !== 'string' ||
      typeof record.createdAt !== 'string' ||
      typeof record.updatedAt !== 'string' ||
      !Array.isArray(record.widgets)
    ) {
      return [];
    }

    const widgets = record.widgets.map((widget) => normalizeWallpaperWidget(widget)).filter((widget): widget is WallpaperWidgetInstance => widget !== null);

    return [{
      id: record.id,
      name: record.name,
      canvasPresetId: record.canvasPresetId,
      widgets,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }];
  });
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
        ? (() => {
            const {
              searchBoxWidth: _searchBoxWidth,
              searchDrawerWidth: _searchDrawerWidth,
              ...appearanceSourceWithoutLegacySearchWidths
            } = appearanceSource as Record<string, unknown>;
            const mergedAppearance = {
              ...defaultAppearance,
              ...appearanceSourceWithoutLegacySearchWidths,
            };

            return {
              ...mergedAppearance,
              desktopSearchMinWidth: mergedAppearance.desktopPageColumnsMinWidth,
              desktopNavMinWidth: mergedAppearance.desktopPageColumnsMinWidth,
            };
          })()
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

function normalizeStructuredOutputJson(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return '';
  }
}

function normalizeIsoDateString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return new Date(parsed).toISOString();
}

type LlmPresetValueType = 'text' | 'json';

function normalizeLlmPresetContent(value: unknown, valueType: LlmPresetValueType): string {
  if (valueType === 'json') {
    return normalizeStructuredOutputJson(value);
  }

  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().length > 0 ? value : '';
}

function normalizeLlmPreset(rawPreset: unknown, valueType: LlmPresetValueType = 'text'): LlmPresetRecord | null {
  if (!rawPreset || typeof rawPreset !== 'object') {
    return null;
  }

  const record = rawPreset as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const content = normalizeLlmPresetContent(record.content, valueType);
  if (!id || !name || !content) {
    return null;
  }

  const createdAt = normalizeIsoDateString(record.createdAt) ?? new Date().toISOString();
  const updatedAt = normalizeIsoDateString(record.updatedAt) ?? createdAt;

  return {
    id,
    name,
    content,
    createdAt,
    updatedAt,
  };
}

function mergeLlmPresetCollections(...collections: LlmPresetRecord[][]): LlmPresetRecord[] {
  const seenNames = new Set<string>();
  const seenIds = new Set<string>();
  const nextPresets: LlmPresetRecord[] = [];

  for (const collection of collections) {
    for (const preset of collection) {
      const nameKey = preset.name.toLowerCase();
      if (seenIds.has(preset.id) || seenNames.has(nameKey)) {
        continue;
      }

      seenIds.add(preset.id);
      seenNames.add(nameKey);
      nextPresets.push(preset);
    }
  }

  return nextPresets;
}

export function normalizeLlmPresets(rawPresets: unknown, valueType: LlmPresetValueType = 'text'): LlmPresetRecord[] {
  if (!Array.isArray(rawPresets)) {
    return [];
  }

  return mergeLlmPresetCollections(rawPresets.flatMap((rawPreset) => {
    const preset = normalizeLlmPreset(rawPreset, valueType);
    return preset ? [preset] : [];
  }));
}

function normalizeLegacyLlmPresets(rawPresets: unknown, contentKey: 'systemPrompt' | 'prompt' | 'structuredOutputJson', valueType: LlmPresetValueType = 'text'): LlmPresetRecord[] {
  if (!Array.isArray(rawPresets)) {
    return [];
  }

  return mergeLlmPresetCollections(rawPresets.flatMap((rawPreset) => {
    if (!rawPreset || typeof rawPreset !== 'object') {
      return [];
    }

    const record = rawPreset as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const content = normalizeLlmPresetContent(record[contentKey], valueType);
    if (!id || !name || !content) {
      return [];
    }

    const createdAt = normalizeIsoDateString(record.createdAt) ?? new Date().toISOString();
    const updatedAt = normalizeIsoDateString(record.updatedAt) ?? createdAt;

    return [{
      id,
      name,
      content,
      createdAt,
      updatedAt,
    }];
  }));
}

export function normalizeLlmSettings(rawLlmSettings: unknown): AppSettings['llm'] {
  const record = rawLlmSettings && typeof rawLlmSettings === 'object'
    ? rawLlmSettings as Record<string, unknown>
    : {};

  return {
    systemPromptPresets: mergeLlmPresetCollections(
      normalizeLlmPresets(record.systemPromptPresets),
      normalizeLegacyLlmPresets(record.presets, 'systemPrompt'),
    ),
    promptPresets: mergeLlmPresetCollections(
      normalizeLlmPresets(record.promptPresets),
      normalizeLegacyLlmPresets(record.presets, 'prompt'),
    ),
    structuredOutputJsonPresets: mergeLlmPresetCollections(
      normalizeLlmPresets(record.structuredOutputJsonPresets, 'json'),
      normalizeLegacyLlmPresets(record.presets, 'structuredOutputJson', 'json'),
    ),
  };
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
      keepModelLoaded: true,
      autoUnloadMinutes: 5,
      artistLinkUrlTemplate: DEFAULT_ARTIST_LINK_URL_TEMPLATE,
    },
    similarity: {
      autoGenerateHashOnUpload: true,
      detailSimilarThreshold: 15,
      detailSimilarLimit: 2,
      detailSimilarIncludeColorSimilarity: false,
      detailSimilarWeights: {
        perceptualHash: 50,
        dHash: 30,
        aHash: 20,
        color: 0,
      },
      detailSimilarThresholds: {
        perceptualHash: 15,
        dHash: 18,
        aHash: 20,
        color: 0,
      },
      detailSimilarUseMetadataFilter: false,
      detailSimilarSortBy: 'similarity',
      detailSimilarSortOrder: 'DESC',
      promptSimilarity: {
        enabled: true,
        algorithm: 'simhash',
        autoBuildOnMetadataUpdate: true,
        resultLimit: 2,
        combinedThreshold: 50,
        weights: {
          positive: 1,
          negative: 1,
          auto: 1,
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
      wallpaperLayoutPresets: [],
      wallpaperActivePresetId: null,
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
    generationThrottle: {
      novelai: {
        maxConcurrentJobs: 1,
        cooldownAfterCompletions: 1,
        cooldownSeconds: 3,
      },
      codex: {
        maxConcurrentJobs: 3,
        cooldownAfterCompletions: 3,
        cooldownSeconds: 60,
      },
      reservations: {
        maxConcurrentJobs: 3,
        userQueuePolicy: 'continue_limited',
      },
    },
    videoOptimization: {
      enabled: true,
      preset: 'balanced',
      crf: 26,
      audioBitrateKbps: 128,
      applyToUpload: true,
      applyToGeneratedOutputs: true,
      applyToBackupImports: true,
    },
    llm: {
      systemPromptPresets: [],
      promptPresets: [],
      structuredOutputJsonPresets: [],
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
  const {
    searchBoxWidth: _searchBoxWidth,
    searchDrawerWidth: _searchDrawerWidth,
    ...loadedAppearanceWithoutLegacySearchWidths
  } = loadedSettings.appearance || {};

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
      detailSimilarWeights: {
        ...defaults.similarity.detailSimilarWeights,
        ...loadedSettings.similarity?.detailSimilarWeights,
      },
      detailSimilarThresholds: {
        ...defaults.similarity.detailSimilarThresholds,
        ...loadedSettings.similarity?.detailSimilarThresholds,
      },
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
      ...loadedAppearanceWithoutLegacySearchWidths,
      desktopSearchMinWidth: loadedSettings.appearance?.desktopPageColumnsMinWidth ?? defaults.appearance.desktopPageColumnsMinWidth,
      desktopNavMinWidth: loadedSettings.appearance?.desktopPageColumnsMinWidth ?? defaults.appearance.desktopPageColumnsMinWidth,
      desktopPageColumnsMinWidth: loadedSettings.appearance?.desktopPageColumnsMinWidth ?? defaults.appearance.desktopPageColumnsMinWidth,
      presetSlots: normalizeAppearancePresetSlots(loadedSettings.appearance?.presetSlots),
      wallpaperLayoutPresets: normalizeWallpaperLayoutPresets(loadedSettings.appearance?.wallpaperLayoutPresets),
      wallpaperActivePresetId: typeof loadedSettings.appearance?.wallpaperActivePresetId === 'string'
        ? loadedSettings.appearance.wallpaperActivePresetId
        : null,
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
    generationThrottle: {
      novelai: {
        ...defaults.generationThrottle.novelai,
        ...loadedSettings.generationThrottle?.novelai,
      },
      codex: {
        ...defaults.generationThrottle.codex,
        ...loadedSettings.generationThrottle?.codex,
      },
      reservations: {
        ...defaults.generationThrottle.reservations,
        ...loadedSettings.generationThrottle?.reservations,
      },
    },
    videoOptimization: {
      ...defaults.videoOptimization,
      ...loadedSettings.videoOptimization,
    },
    llm: {
      ...defaults.llm,
      ...normalizeLlmSettings(loadedSettings.llm),
    },
  };
}

/** Check whether persisted settings are missing any top-level section fields from current defaults. */
export function hasMissingSettingsFields(loaded: any, defaults: AppSettings): boolean {
  for (const key of Object.keys(defaults.general)) {
    if (!(key in (loaded.general || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.tagger)) {
    if (!(key in (loaded.tagger || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.similarity)) {
    if (!(key in (loaded.similarity || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.kaloscope)) {
    if (!(key in (loaded.kaloscope || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.appearance)) {
    if (!(key in (loaded.appearance || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.metadataExtraction)) {
    if (!(key in (loaded.metadataExtraction || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.thumbnail)) {
    if (!(key in (loaded.thumbnail || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.imageSave)) {
    if (!(key in (loaded.imageSave || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.generationThrottle.novelai)) {
    if (!(key in (loaded.generationThrottle?.novelai || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.generationThrottle.codex)) {
    if (!(key in (loaded.generationThrottle?.codex || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.generationThrottle.reservations)) {
    if (!(key in (loaded.generationThrottle?.reservations || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.videoOptimization)) {
    if (!(key in (loaded.videoOptimization || {}))) {
      return true;
    }
  }

  for (const key of Object.keys(defaults.llm)) {
    if (!(key in (loaded.llm || {}))) {
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
