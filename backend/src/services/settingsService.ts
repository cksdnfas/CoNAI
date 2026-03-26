import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import {
  AppSettings,
  GeneralSettings,
  TaggerSettings,
  KaloscopeSettings,
  SimilaritySettings,
  AppearanceSettings,
  AppearancePresetSlot,
  AppearanceThemeSettings,
  MetadataExtractionSettings,
  ThumbnailSettings,
  TaggerModel,
  TaggerModelInfo,
  TaggerDevice,
  SupportedLanguage,
} from '../types/settings';
import { cleanupUnusedAppearanceFontFiles } from './appearanceFontAssetService';

const SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'settings.json');

const MODEL_REPO_MAP: Record<TaggerModel, string> = {
  vit: 'SmilingWolf/wd-vit-tagger-v3',
  swinv2: 'SmilingWolf/wd-swinv2-tagger-v3',
  convnext: 'SmilingWolf/wd-convnext-tagger-v3',
};

const MODEL_INFO: Record<TaggerModel, { label: string; description: string }> = {
  vit: {
    label: 'ViT (Vision Transformer)',
    description: '빠른 속도, 높은 정확도 - 일반적인 사용에 권장',
  },
  swinv2: {
    label: 'SwinV2 (Swin Transformer V2)',
    description: '보통 속도, 매우 높은 정확도 - 높은 정확도가 필요한 경우',
  },
  convnext: {
    label: 'ConvNeXt',
    description: '빠른 속도, 높은 정확도 - 빠른 처리가 필요한 경우',
  },
};

const APPEARANCE_PRESET_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3'] as const;

function getDefaultAppearanceTheme(): AppearanceThemeSettings {
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
    searchBoxWidth: 380,
    searchDrawerWidth: 420,
    desktopSearchMinWidth: 768,
    desktopNavMinWidth: 1024,
    detailRelatedImageMobileColumns: 1,
    detailRelatedImageColumns: 3,
    detailRelatedImageAspectRatio: 'square',
    positiveBadgeColor: '#34d399',
    negativeBadgeColor: '#fb7185',
    autoBadgeColor: '#38bdf8',
    ratingBadgeColor: '#a78bfa',
  };
}

function getDefaultAppearancePresetSlots(): AppearancePresetSlot[] {
  return APPEARANCE_PRESET_SLOT_IDS.map((id, index) => ({
    id,
    label: `Slot ${index + 1}`,
    appearance: null,
    updatedAt: null,
  }));
}

function normalizeAppearancePresetSlots(rawSlots: unknown): AppearancePresetSlot[] {
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

export class SettingsService {
  private settings: AppSettings | null = null;

  /**
   * Get default settings from environment variables
   */
  getDefaultSettings(): AppSettings {
    return {
      general: {
        language: 'ko',  // 기본 언어: 한국어
        deleteProtection: {
          enabled: true,  // 기본값: 활성화
          recycleBinPath: 'RecycleBin'
        },
        enableGallery: true,  // 기본값: 갤러리 활성화
        autoCleanupCanvasOnShutdown: false,  // 기본값: Canvas 폴더 유지 (삭제하지 않음)
        showRatingBadges: true  // 기본값: Rating 배지 표시
      },
      tagger: {
        enabled: process.env.TAGGER_ENABLED === 'true',
        autoTagOnUpload: false,    // 기본값: 업로드 시 자동 태깅 안 함
        model: (process.env.TAGGER_MODEL as TaggerModel) || 'vit',
        device: (process.env.TAGGER_DEVICE as TaggerDevice) || 'auto',  // 기본값: 자동 감지
        generalThreshold: parseFloat(process.env.TAGGER_GEN_THRESHOLD || '0.35'),
        characterThreshold: parseFloat(process.env.TAGGER_CHAR_THRESHOLD || '0.75'),
        pythonPath: process.env.PYTHON_PATH || 'python',
        keepModelLoaded: true,     // 기본값: 자동 언로드 활성화 (메모리 관리 활성)
        autoUnloadMinutes: 5,      // 기본값: 5분 후 자동 언로드
      },
      kaloscope: {
        enabled: process.env.KALOSCOPE_ENABLED === 'true',
        autoTagOnUpload: false,
        device: ((process.env.KALOSCOPE_DEVICE as 'auto' | 'cpu' | 'cuda') || 'auto'),
        topK: Number.parseInt(process.env.KALOSCOPE_TOPK || '15', 10),
      },
      similarity: {
        autoGenerateHashOnUpload: true,   // 기본값: 자동 해시 생성
        detailSimilarThreshold: 15,       // 기본값: 보통 범위
        detailSimilarLimit: 24,           // 기본값: 24개
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
        enableSecondaryExtraction: true,      // 기본값: Secondary Extraction 활성화
        stealthScanMode: 'fast',              // 기본값: 빠른 스캔 (권장)
        stealthMaxFileSizeMB: 10,             // 기본값: 10MB 이상 스킵
        stealthMaxResolutionMP: 5,            // 기본값: 5MP 이상 스킵
        skipStealthForComfyUI: true,          // 기본값: ComfyUI 스킵
        skipStealthForWebUI: false,           // 기본값: WebUI 검사
      },
      thumbnail: {
        size: '1080',      // 기본값: 1080px
        quality: 80,       // 기본값: 80% 품질
      },
    };
  }

  /**
   * Ensure config directory exists
   */
  private ensureConfigDirectory(): void {
    const configDir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  /**
   * Load settings from file or create default
   */
  loadSettings(): AppSettings {
    if (this.settings) {
      return this.settings;
    }

    try {
      if (fs.existsSync(SETTINGS_FILE_PATH)) {
        const fileContent = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
        const loadedSettings = JSON.parse(fileContent);

        // Merge with defaults to ensure all new fields are present
        // User settings take precedence over defaults
        const defaults = this.getDefaultSettings();
        this.settings = {
          general: {
            ...defaults.general,
            ...loadedSettings.general,
          },
          tagger: {
            ...defaults.tagger,
            ...loadedSettings.tagger,
            // Environment variable takes highest precedence (for Docker deployments)
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
        };

        console.log('[SettingsService] Loaded settings from file:', {
          tagger_enabled: this.settings.tagger.enabled,
          tagger_model: this.settings.tagger.model,
          tagger_device: this.settings.tagger.device,
          kaloscope_enabled: this.settings.kaloscope.enabled,
          kaloscope_device: this.settings.kaloscope.device,
          kaloscope_topK: this.settings.kaloscope.topK,
          similarity_autoHash: this.settings.similarity.autoGenerateHashOnUpload
        });

        // Check for missing fields only (not field order differences)
        const needsMigration = this.checkForMissingFields(loadedSettings, defaults);
        if (needsMigration) {
          console.log('[SettingsService] Adding missing fields to settings file');
          this.saveSettings(this.settings);
        }
      } else {
        this.settings = this.getDefaultSettings();
        this.saveSettings(this.settings);
        console.log('[SettingsService] Created default settings file');
      }
    } catch (error) {
      console.error('[SettingsService] Error loading settings:', error);
      this.settings = this.getDefaultSettings();
    }

    // TypeScript guard: this.settings should never be null at this point
    return this.settings!;
  }

  /**
   * Check if loaded settings are missing any fields from defaults
   */
  private checkForMissingFields(loaded: any, defaults: AppSettings): boolean {
    // Check general fields
    for (const key of Object.keys(defaults.general)) {
      if (!(key in (loaded.general || {}))) {
        console.log(`[SettingsService] Missing field: general.${key}`);
        return true;
      }
    }

    // Check tagger fields
    for (const key of Object.keys(defaults.tagger)) {
      if (!(key in (loaded.tagger || {}))) {
        console.log(`[SettingsService] Missing field: tagger.${key}`);
        return true;
      }
    }

    // Check similarity fields
    for (const key of Object.keys(defaults.similarity)) {
      if (!(key in (loaded.similarity || {}))) {
        console.log(`[SettingsService] Missing field: similarity.${key}`);
        return true;
      }
    }

    // Check kaloscope fields
    for (const key of Object.keys(defaults.kaloscope)) {
      if (!(key in (loaded.kaloscope || {}))) {
        console.log(`[SettingsService] Missing field: kaloscope.${key}`);
        return true;
      }
    }

    // Check appearance fields
    for (const key of Object.keys(defaults.appearance)) {
      if (!(key in (loaded.appearance || {}))) {
        console.log(`[SettingsService] Missing field: appearance.${key}`);
        return true;
      }
    }

    // Check metadata extraction fields
    for (const key of Object.keys(defaults.metadataExtraction)) {
      if (!(key in (loaded.metadataExtraction || {}))) {
        console.log(`[SettingsService] Missing field: metadataExtraction.${key}`);
        return true;
      }
    }

    // Check thumbnail fields
    for (const key of Object.keys(defaults.thumbnail)) {
      if (!(key in (loaded.thumbnail || {}))) {
        console.log(`[SettingsService] Missing field: thumbnail.${key}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Save settings to file
   */
  saveSettings(settings: AppSettings): void {
    try {
      this.ensureConfigDirectory();
      fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
      this.settings = settings;
      console.log('[SettingsService] Settings saved successfully:', {
        tagger_enabled: settings.tagger.enabled,
        kaloscope_enabled: settings.kaloscope.enabled,
        similarity_autoHash: settings.similarity.autoGenerateHashOnUpload
      });
    } catch (error) {
      console.error('[SettingsService] Error saving settings:', error);
      throw new Error('Failed to save settings');
    }
  }

  /**
   * Update general settings
   */
  updateGeneralSettings(generalSettings: Partial<GeneralSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      general: {
        ...currentSettings.general,
        ...generalSettings,
      },
    };
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update tagger settings
   */
  updateTaggerSettings(taggerSettings: Partial<TaggerSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      tagger: {
        ...currentSettings.tagger,
        ...taggerSettings,
      },
    };
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update kaloscope settings
   */
  updateKaloscopeSettings(kaloscopeSettings: Partial<KaloscopeSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      kaloscope: {
        ...currentSettings.kaloscope,
        ...kaloscopeSettings,
      },
    };
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update similarity settings
   */
  updateSimilaritySettings(similaritySettings: Partial<SimilaritySettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
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
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update appearance settings
   */
  updateAppearanceSettings(appearanceSettings: Partial<AppearanceSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        ...appearanceSettings,
      },
    };
    this.saveSettings(updatedSettings);
    cleanupUnusedAppearanceFontFiles(updatedSettings.appearance);
    return updatedSettings;
  }

  /**
   * Update metadata extraction settings
   */
  updateMetadataSettings(metadataSettings: Partial<MetadataExtractionSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      metadataExtraction: {
        ...currentSettings.metadataExtraction,
        ...metadataSettings,
      },
    };
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update thumbnail settings
   */
  updateThumbnailSettings(thumbnailSettings: Partial<ThumbnailSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings: AppSettings = {
      ...currentSettings,
      thumbnail: {
        ...currentSettings.thumbnail,
        ...thumbnailSettings,
      },
    };
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Check if a model is downloaded
   * Improved: Check for actual model files in snapshots directory
   */
  isModelDownloaded(model: TaggerModel): boolean {
    const repoId = MODEL_REPO_MAP[model];
    const modelDirName = `models--${repoId.replace('/', '--')}`;

    // Try both possible cache structures:
    // 1. modelsDir/models--org--name (direct)
    // 2. modelsDir/hub/models--org--name (nested)
    const possiblePaths = [
      path.join(runtimePaths.modelsDir, modelDirName),
      path.join(runtimePaths.modelsDir, 'hub', modelDirName),
    ];

    for (const modelBasePath of possiblePaths) {
      // Check if base directory exists
      if (!fs.existsSync(modelBasePath)) {
        continue;
      }

      console.log(`[SettingsService] Checking model ${model} at: ${modelBasePath}`);

      // Check for snapshots directory
      const snapshotsPath = path.join(modelBasePath, 'snapshots');
      if (!fs.existsSync(snapshotsPath)) {
        console.log(`[SettingsService] No snapshots directory found for ${model}`);
        continue;
      }

      // Check if there's any snapshot with model files
      try {
        const snapshots = fs.readdirSync(snapshotsPath);
        console.log(`[SettingsService] Found ${snapshots.length} snapshots for ${model}`);

        if (snapshots.length === 0) {
          continue;
        }

        // Check if at least one snapshot has model files (.safetensors, .bin, .csv, etc.)
        for (const snapshot of snapshots) {
          const snapshotPath = path.join(snapshotsPath, snapshot);
          if (fs.statSync(snapshotPath).isDirectory()) {
            const files = fs.readdirSync(snapshotPath);
            console.log(`[SettingsService] Snapshot ${snapshot} has ${files.length} files`);

            // Look for model files (safetensors, bin) or CSV files (for tags)
            const hasModelFiles = files.some(f =>
              f.endsWith('.safetensors') ||
              f.endsWith('.bin') ||
              f.endsWith('.csv') ||
              f === 'selected_tags.csv'
            );

            if (hasModelFiles) {
              console.log(`[SettingsService] Model ${model} is downloaded at ${modelBasePath}`);
              return true;
            }
          }
        }
      } catch (error) {
        console.error(`[SettingsService] Error checking model ${model} at ${modelBasePath}:`, error);
        continue;
      }
    }

    console.log(`[SettingsService] Model ${model} not found in any cache location`);
    return false;
  }

  /**
   * Get list of available models with download status
   */
  getModelsList(): TaggerModelInfo[] {
    const models: TaggerModel[] = ['vit', 'swinv2', 'convnext'];

    return models.map(model => ({
      name: model,
      label: MODEL_INFO[model].label,
      description: MODEL_INFO[model].description,
      downloaded: this.isModelDownloaded(model),
    }));
  }

  /**
   * Get model repository ID
   */
  getModelRepoId(model: TaggerModel): string {
    return MODEL_REPO_MAP[model];
  }

  /**
   * Reload settings from file (invalidate cache)
   */
  reloadSettings(): AppSettings {
    this.settings = null;
    return this.loadSettings();
  }
}

// Export singleton instance
export const settingsService = new SettingsService();
