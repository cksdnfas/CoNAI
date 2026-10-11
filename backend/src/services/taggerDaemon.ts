import { settingsService } from './settingsService';
import { analyzeMedia, visionWorker } from './aiWorker/aiVisionService';
import type { TaggerModel, TaggerServerStatus } from '@conai/shared';

export interface TaggerResult {
  success: boolean;
  caption?: string;
  taglist?: string;
  rating?: Record<string, number>;
  general?: Record<string, number>;
  character?: Record<string, number>;
  /** PixAI only: artist (style) and meta tags, kept apart from the general ones. */
  artist?: Record<string, number>;
  meta?: Record<string, number>;
  model?: string;
  thresholds?: {
    general: number;
    character: number;
  };
  error?: string;
  error_type?: string;
}

/**
 * WD tagger on the shared AI vision worker (`conai_worker.py`). The worker starts on first use and unloads the
 * model after the tagger's idle setting; this class only keeps the API the routes and services already use.
 */
class TaggerDaemon {
  /** The worker starts lazily on the first request; nothing to do up front. */
  async start(): Promise<void> {}

  /** Stop the whole vision worker (Kaloscope shares it); the next request starts it again. */
  async stop(): Promise<void> {
    await visionWorker.stop();
  }

  async loadModel(model?: TaggerModel, device?: string): Promise<void> {
    const tagger = settingsService.loadSettings().tagger;
    const status = await visionWorker.request<{ models: Record<string, { device: string }> }>(
      'load',
      { model: 'wd', options: { variant: model || tagger.model, device: device || tagger.device || 'auto' } },
      { priority: 'high' },
    );
    visionWorker.touch('wd', status.models?.wd?.device ?? null);
  }

  async unloadModel(): Promise<void> {
    await visionWorker.unload(['wd']);
  }

  async tagImage(imagePath: string): Promise<TaggerResult> {
    const result = await analyzeMedia(imagePath, false, { tagger: true });
    return result.tagger ?? { success: false, error: 'Tagger returned nothing', error_type: 'WorkerError' };
  }

  async getStatus(): Promise<TaggerServerStatus> {
    const status = visionWorker.status();
    const wd = status.models.wd;
    return {
      isRunning: status.running,
      modelLoaded: Boolean(wd),
      currentModel: wd ? settingsService.loadSettings().tagger.model : null,
      currentDevice: wd?.device ?? null,
      lastUsedAt: wd?.lastUsedAt ?? null,
    };
  }

  isRunning(): boolean {
    return visionWorker.running;
  }
}

export const taggerDaemon = new TaggerDaemon();
