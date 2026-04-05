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
  MetadataExtractionSettings,
  ThumbnailSettings,
  TaggerModel,
  TaggerModelInfo,
  SupportedLanguage,
} from '../types/settings';
import { cleanupUnusedAppearanceFontFiles } from './appearanceFontAssetService';
import {
  SETTINGS_FILE_PATH,
  getDefaultSettingsFromEnvironment,
  hasMissingSettingsFields,
  mergeLoadedSettingsWithDefaults,
  readRawSettingsFile,
  writeSettingsFile,
} from './settingsServiceStorage';
import {
  applyAppearanceSettingsUpdate,
  applyGeneralSettingsUpdate,
  applyImageSaveSettingsUpdate,
  applyKaloscopeSettingsUpdate,
  applyMetadataSettingsUpdate,
  applySimilaritySettingsUpdate,
  applyTaggerSettingsUpdate,
  applyThumbnailSettingsUpdate,
} from './settingsServiceUpdates';

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

export class SettingsService {
  private settings: AppSettings | null = null;

  /**
   * Get default settings from environment variables
   */
  getDefaultSettings(): AppSettings {
    return getDefaultSettingsFromEnvironment();
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
        this.settings = mergeLoadedSettingsWithDefaults(loadedSettings, defaults);

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
        const needsMigration = hasMissingSettingsFields(loadedSettings, defaults);
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
  /**
   * Save settings to file
   */
  saveSettings(settings: AppSettings): void {
    try {
      writeSettingsFile(settings);
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
    const updatedSettings = applyGeneralSettingsUpdate(currentSettings, generalSettings);
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update tagger settings
   */
  updateTaggerSettings(taggerSettings: Partial<TaggerSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applyTaggerSettingsUpdate(currentSettings, taggerSettings);
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update kaloscope settings
   */
  updateKaloscopeSettings(kaloscopeSettings: Partial<KaloscopeSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applyKaloscopeSettingsUpdate(currentSettings, kaloscopeSettings);
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update similarity settings
   */
  updateSimilaritySettings(similaritySettings: Partial<SimilaritySettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applySimilaritySettingsUpdate(currentSettings, similaritySettings);
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update appearance settings
   */
  updateAppearanceSettings(appearanceSettings: Partial<AppearanceSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applyAppearanceSettingsUpdate(currentSettings, appearanceSettings);
    this.saveSettings(updatedSettings);
    cleanupUnusedAppearanceFontFiles(updatedSettings.appearance);
    return updatedSettings;
  }

  /**
   * Update metadata extraction settings
   */
  updateMetadataSettings(metadataSettings: Partial<MetadataExtractionSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applyMetadataSettingsUpdate(currentSettings, metadataSettings);
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update thumbnail settings
   */
  updateThumbnailSettings(thumbnailSettings: Partial<ThumbnailSettings>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applyThumbnailSettingsUpdate(currentSettings, thumbnailSettings);
    this.saveSettings(updatedSettings);
    return updatedSettings;
  }

  /**
   * Update image save settings
   */
  updateImageSaveSettings(imageSaveSettings: Partial<AppSettings['imageSave']>): AppSettings {
    const currentSettings = this.loadSettings();
    const updatedSettings = applyImageSaveSettingsUpdate(currentSettings, imageSaveSettings);
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
