import fs from 'fs';
import path from 'path';
import { runtimePaths } from '../config/runtimePaths';
import { AppSettings, TaggerSettings, TaggerModel, TaggerModelInfo } from '../types/settings';

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

export class SettingsService {
  private settings: AppSettings | null = null;

  /**
   * Get default settings from environment variables
   */
  private getDefaultSettings(): AppSettings {
    return {
      tagger: {
        enabled: process.env.TAGGER_ENABLED === 'true',
        model: (process.env.TAGGER_MODEL as TaggerModel) || 'vit',
        generalThreshold: parseFloat(process.env.TAGGER_GEN_THRESHOLD || '0.35'),
        characterThreshold: parseFloat(process.env.TAGGER_CHAR_THRESHOLD || '0.75'),
        pythonPath: process.env.PYTHON_PATH || 'python',
        autoTagOnUpload: false,
        keepModelLoaded: false,    // 기본값: 메모리 유지 안 함
        autoUnloadMinutes: 5,      // 기본값: 5분 후 자동 언로드
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
        const defaults = this.getDefaultSettings();
        this.settings = {
          tagger: {
            ...defaults.tagger,
            ...loadedSettings.tagger,
          },
        };

        // Check if any new fields were added
        const hasNewFields = JSON.stringify(this.settings) !== JSON.stringify(loadedSettings);
        if (hasNewFields) {
          console.log('[SettingsService] Migrating settings with new default fields');
          this.saveSettings(this.settings);
        } else {
          console.log('[SettingsService] Loaded settings from file');
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
   * Save settings to file
   */
  saveSettings(settings: AppSettings): void {
    try {
      this.ensureConfigDirectory();
      fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf-8');
      this.settings = settings;
      console.log('[SettingsService] Settings saved successfully');
    } catch (error) {
      console.error('[SettingsService] Error saving settings:', error);
      throw new Error('Failed to save settings');
    }
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
