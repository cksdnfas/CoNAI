import { readPageSettings, verifyPageSettingsWrite } from '../../services/pageSettings';
import { Router, Request, Response } from 'express';
import type { EmbeddingServerStatus, EmbeddingSettings } from '@conai/shared';
import { asyncHandler } from '../../middleware/asyncHandler';
import { settingsService } from '../../services/settingsService';
import {
  EMBEDDING_MODEL,
  EMBEDDING_MODEL_KEY,
  EMBEDDING_REPO,
  embeddingFailure,
  embeddingRuntime,
  isEmbeddingModelCached,
  resetEmbeddingBackoff,
  textWorker,
  warmEmbeddingModel,
} from '../../services/aiWorker/textEmbeddingService';
import { semanticIndexer, SEMANTIC_SPACES } from '../../services/embeddings/semanticIndex';
import { imageIndexCount, MEDIA_IMAGE_SPACE } from '../../services/embeddings/imageIndex';
import { vectorStore } from '../../services/vectors/vectorStore';
import { sendRouteBadRequest } from '../routeValidation';

const router = Router();
const FLAGS = ['enabled', 'chatRecall', 'lorebook', 'chatHistory', 'fileSearch', 'postSearch', 'imageSearch', 'keepModelLoaded'] as const;

async function embeddingStatus(): Promise<EmbeddingServerStatus> {
  const settings = settingsService.loadSettings().embedding;
  const dependencies = await embeddingRuntime.checkDependencies();
  const worker = textWorker.status();
  const failure = embeddingFailure();
  return {
    enabled: settings.enabled,
    dependenciesAvailable: dependencies.available,
    statusMessage: failure ?? dependencies.message,
    failure,
    model: EMBEDDING_MODEL,
    modelRepo: EMBEDDING_REPO,
    modelCached: isEmbeddingModelCached(),
    modelLoaded: Boolean(worker.models.embedding),
    isRunning: worker.running,
    lastUsedAt: worker.models.embedding?.lastUsedAt ?? null,
    indexed: [
      ...Object.values(SEMANTIC_SPACES).map((space) => ({ space, items: vectorStore.count(space, EMBEDDING_MODEL_KEY) })),
      { space: MEDIA_IMAGE_SPACE, items: imageIndexCount() },
    ],
    indexing: semanticIndexer.indexing,
    download: worker.download,
  };
}

router.get(
  '/embedding/status',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ success: true, data: await embeddingStatus() });
  })
);

router.put(
  '/embedding',
  asyncHandler(async (req: Request, res: Response) => {
    const patch: Partial<EmbeddingSettings> = req.body ?? {};
    for (const flag of FLAGS) {
      if (patch[flag] !== undefined && typeof patch[flag] !== 'boolean') {
        sendRouteBadRequest(res, `${flag} must be a boolean`);
        return;
      }
    }
    if (patch.autoUnloadMinutes !== undefined && (!Number.isInteger(patch.autoUnloadMinutes) || patch.autoUnloadMinutes < 1 || patch.autoUnloadMinutes > 1440)) {
      sendRouteBadRequest(res, 'autoUnloadMinutes must be an integer between 1 and 1440');
      return;
    }
    const next: Partial<EmbeddingSettings> = {};
    for (const flag of FLAGS) if (patch[flag] !== undefined) next[flag] = patch[flag];
    if (patch.autoUnloadMinutes !== undefined) next.autoUnloadMinutes = patch.autoUnloadMinutes;

    const previous = settingsService.loadSettings().embedding;
    if (!verifyPageSettingsWrite(res)) return;
    const updated = settingsService.updateEmbeddingSettings(next).embedding;
    resetEmbeddingBackoff();
    if (previous.enabled && !updated.enabled) {
      await textWorker.stop();
    } else if (updated.enabled) {
      // Turned on (or the image part toggled): fetch and load the model now, not on the first chat turn.
      if (!previous.enabled || previous.imageSearch !== updated.imageSearch || !isEmbeddingModelCached()) {
        void warmEmbeddingModel();
      }
      semanticIndexer.poke();
    }
    res.json({ success: true, data: { settings: updated, status: await embeddingStatus(), pageSettingsRevisions: { embedding: readPageSettings('embedding').revision } } });
  })
);

router.post(
  '/embedding/unload-model',
  asyncHandler(async (_req: Request, res: Response) => {
    await textWorker.unload(['embedding']);
    res.json({ success: true, data: await embeddingStatus() });
  })
);

export { router as embeddingSettingsRoutes };
