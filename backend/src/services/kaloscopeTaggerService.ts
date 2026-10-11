import fs from 'fs';
import { db } from '../database/init';
import { settingsService } from './settingsService';
import { KALOSCOPE_MODEL, KaloscopeResult } from './autoTagsComposeService';
import { KaloscopeServerStatus, KaloscopeSettings } from '@conai/shared';
import {
  analyzeMedia,
  checkAiDependencies,
  isHubModelCached,
  KALOSCOPE_FILE,
  KALOSCOPE_REPO,
  visionWorker,
} from './aiWorker/aiVisionService';

interface KaloscopeServiceOptions {
  topk?: number;
  /** Store the style vector for this media. */
  compositeHash?: string;
}

interface KaloscopeDependencyStatus {
  available: boolean;
  missingPackages: string[];
  message: string;
  installCommand?: string;
}

interface KaloscopeRuntimeStatus {
  isRunning: boolean;
  modelLoaded: boolean;
  currentModel: string | null;
  currentDevice: string | null;
  lastUsedAt: string | null;
}

/**
 * Kaloscope 3.0 preview (artist classifier + style vector) on the shared AI vision worker. Keeps the API the
 * routes and services already use; the model loads on first use and unloads after its idle setting.
 */
class KaloscopeTaggerService {
  private getKaloscopeSettings(): KaloscopeSettings {
    return settingsService.loadSettings().kaloscope;
  }

  isModelCached(): boolean {
    return isHubModelCached(KALOSCOPE_REPO, KALOSCOPE_FILE);
  }

  async checkDependencies(): Promise<KaloscopeDependencyStatus> {
    const status = await checkAiDependencies();
    return { available: status.available, missingPackages: status.missingPackages, message: status.message };
  }

  async getServerStatus(): Promise<KaloscopeServerStatus> {
    const settings = this.getKaloscopeSettings();
    const dependencyStatus = await this.checkDependencies();
    const runtimeStatus = await this.getStatus();

    return {
      enabled: settings.enabled,
      autoTagOnUpload: settings.autoTagOnUpload,
      currentDevice: runtimeStatus.currentDevice,
      currentModel: runtimeStatus.currentModel,
      modelLoaded: runtimeStatus.modelLoaded,
      isRunning: runtimeStatus.isRunning,
      lastUsedAt: runtimeStatus.lastUsedAt,
      topK: settings.topK,
      keepModelLoaded: settings.keepModelLoaded,
      autoUnloadMinutes: settings.autoUnloadMinutes,
      scriptExists: true,
      modelCached: this.isModelCached(),
      modelRepo: KALOSCOPE_REPO,
      modelFile: KALOSCOPE_FILE,
      dependenciesAvailable: dependencyStatus.available,
      missingPackages: dependencyStatus.missingPackages,
      statusMessage: dependencyStatus.message,
      outdatedResults: this.countOutdatedResults(),
    };
  }

  private outdatedCache: { count: number; at: number } | null = null;

  /** Items whose stored artist result (success or failure) came from another model. Cached for a minute. */
  countOutdatedResults(): number {
    if (this.outdatedCache && Date.now() - this.outdatedCache.at < 60_000) {
      return this.outdatedCache.count;
    }
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM media_metadata
      WHERE auto_tags IS NOT NULL AND json_valid(auto_tags)
        AND json_type(auto_tags, '$.kaloscope') = 'object'
        AND json_extract(auto_tags, '$.kaloscope.model') IS NOT ?
    `).get(KALOSCOPE_MODEL) as { count: number };
    this.outdatedCache = { count: row.count, at: Date.now() };
    return row.count;
  }

  /**
   * Drop outdated artist results so the auto-tag scheduler extracts them again with the current model. Removing
   * `$.kaloscope` re-arms `auto_tag_state` through the media_metadata triggers; the search index keeps the old
   * artists until each item is re-tagged. Runs in rowid chunks so a large library never holds one long write.
   */
  async requeueOutdatedResults(): Promise<number> {
    const nextRange = db.prepare('SELECT rowid AS id FROM media_metadata WHERE rowid > ? ORDER BY rowid LIMIT 1 OFFSET 499');
    const requeue = db.prepare(`
      UPDATE media_metadata
      SET auto_tags = json_remove(auto_tags, '$.kaloscope')
      WHERE rowid > ? AND rowid <= ?
        AND auto_tags IS NOT NULL AND json_valid(auto_tags)
        AND json_type(auto_tags, '$.kaloscope') = 'object'
        AND json_extract(auto_tags, '$.kaloscope.model') IS NOT ?
    `);
    let total = 0;
    let cursor = 0;
    for (;;) {
      const end = nextRange.get(cursor) as { id: number } | undefined;
      const to = end ? end.id : Number.MAX_SAFE_INTEGER;
      total += requeue.run(cursor, to, KALOSCOPE_MODEL).changes;
      if (!end) break;
      cursor = to;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.outdatedCache = null;
    return total;
  }

  /** Preconditions shared by image and video tagging. */
  private async ensureReady(targetPath: string, targetLabel: 'Image' | 'Video'): Promise<KaloscopeResult | null> {
    if (!this.getKaloscopeSettings().enabled) {
      return { success: false, error: 'Kaloscope is disabled', error_type: 'Disabled' };
    }
    if (!fs.existsSync(targetPath)) {
      return { success: false, error: `${targetLabel} not found: ${targetPath}`, error_type: 'FileNotFound' };
    }
    return null;
  }

  async startDaemon(): Promise<void> {}

  /** Stop the whole vision worker (the tagger shares it); the next request starts it again. */
  async stopDaemon(): Promise<void> {
    await visionWorker.stop();
  }

  async loadModel(device?: string): Promise<void> {
    const settings = this.getKaloscopeSettings();
    const status = await visionWorker.request<{ models: Record<string, { device: string }> }>(
      'load',
      { model: 'kaloscope', options: { device: device || settings.device || 'auto' } },
      { priority: 'high' },
    );
    visionWorker.touch('kaloscope', status.models?.kaloscope?.device ?? null);
  }

  async unloadModel(): Promise<void> {
    await visionWorker.unload(['kaloscope']);
  }

  async tagImage(imagePath: string, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    return this.tag(imagePath, false, options);
  }

  /** Frames are averaged inside the worker (probabilities and style vector). */
  async tagVideo(videoPath: string, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    return this.tag(videoPath, true, options);
  }

  private async tag(targetPath: string, isVideo: boolean, options?: KaloscopeServiceOptions): Promise<KaloscopeResult> {
    const readyError = await this.ensureReady(targetPath, isVideo ? 'Video' : 'Image');
    if (readyError) return readyError;
    const result = await analyzeMedia(targetPath, isVideo, { kaloscope: { topk: options?.topk } }, { compositeHash: options?.compositeHash });
    if (!result.kaloscope) {
      return { success: false, error: 'Kaloscope returned nothing', error_type: 'WorkerError' };
    }
    // The style vector is stored by hash (when given); callers get the artist result only.
    const { style: _style, ...kaloscope } = result.kaloscope;
    return kaloscope;
  }

  async getStatus(): Promise<KaloscopeRuntimeStatus> {
    const status = visionWorker.status();
    const kaloscope = status.models.kaloscope;
    return {
      isRunning: status.running,
      modelLoaded: Boolean(kaloscope),
      currentModel: kaloscope ? KALOSCOPE_MODEL : null,
      currentDevice: kaloscope?.device ?? null,
      lastUsedAt: kaloscope?.lastUsedAt ?? null,
    };
  }

  /** Settings are read per request; only a device change needs the loaded model dropped. */
  async reloadConfig(): Promise<void> {
    await visionWorker.unload(['kaloscope']);
  }
}

export const kaloscopeTaggerService = new KaloscopeTaggerService();
